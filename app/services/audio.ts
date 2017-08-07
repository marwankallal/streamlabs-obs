import Vue from 'vue';
import { Subject } from 'rxjs/Subject';
import { Subscription } from 'rxjs/Subscription';
import { mutation, StatefulService, InitAfter, Inject, Mutator } from './stateful-service';
import { SourcesService, ISource, Source } from './sources';
import { ScenesService } from './scenes';
import { ObsFader, EFaderType, ObsVolmeter } from './obs-api';
import Utils from './utils';

const VOLMETER_UPDATE_INTERVAL = 40;

export interface IAudioSource {
  sourceId: string;
  fader: IFader;
}

export interface IVolmeter {
  level: number;
  magnitude: number;
  peak: number;
  muted: boolean;
}

interface IFader {
  db: number;
  deflection: number;
  mul: number;
}

interface IAudioSourcesState {
  audioSources: Dictionary<IAudioSource>;
}


@InitAfter(SourcesService)
export class AudioService extends StatefulService<IAudioSourcesState> {

  static initialState: IAudioSourcesState = {
    audioSources: {}
  };

  obsFaders: Dictionary<ObsFader> = {};
  obsVolmeters: Dictionary<ObsVolmeter> = {};

  @Inject() private sourcesService: SourcesService;
  @Inject() private scenesService: ScenesService;


  protected init() {

    this.sourcesService.sourceAdded.subscribe(sourceModel => {
      const source = this.sourcesService.getSource(sourceModel.sourceId);
      if (!source.audio) return;
      this.createAudioSource(source);
    });

    this.sourcesService.sourceUpdated.subscribe(source => {
      const audioSource = this.getSource(source.sourceId);
      if (!audioSource) return;

      if (!source.audio) {
        this.removeAudioSource(source.sourceId);
        return;
      }

    });

    this.sourcesService.sourceRemoved.subscribe(source => {
      if (source.audio) this.removeAudioSource(source.sourceId);
    });

  }

  getSource(sourceId: string): AudioSource {
    return this.state.audioSources[sourceId] ? new AudioSource(sourceId) : void 0;
  }


  getSourcesForCurrentScene(): AudioSource[] {
    const scene = this.scenesService.activeScene;
    const sceneSources = scene.getItems().filter(source => source.audio);
    const globalSources = this.sourcesService.getSources().filter(source => source.isGlobal);
    return globalSources
      .concat(sceneSources)
      .map((sceneSource: ISource) => this.getSource(sceneSource.sourceId))
      .filter(item => item);
  }


  fetchAudioSource(sourceName: string): IAudioSource {
    const source = this.sourcesService.getSourceByName(sourceName);
    const obsFader = this.obsFaders[source.sourceId];

    const fader: IFader = {
      db: obsFader.db | 0,
      deflection: obsFader.deflection,
      mul: obsFader.mul
    };

    return {
      sourceId: source.sourceId,
      fader
    };
  }


  private createAudioSource(source: Source) {
    const obsVolmeter = ObsVolmeter.create(EFaderType.IEC);
    obsVolmeter.attach(source.getObsInput());
    this.obsVolmeters[source.sourceId] = obsVolmeter;

    const obsFader = ObsFader.create(EFaderType.IEC);
    obsFader.attach(source.getObsInput());
    this.obsFaders[source.sourceId] = obsFader;

    this.ADD_AUDIO_SOURCE(this.fetchAudioSource(source.name));
  }

  private removeAudioSource(sourceId: string) {
    delete this.obsFaders[sourceId];
    delete this.obsVolmeters[sourceId];
    this.REMOVE_AUDIO_SOURCE(sourceId);
  }


  @mutation()
  private ADD_AUDIO_SOURCE(source: IAudioSource) {
    Vue.set(this.state.audioSources, source.sourceId, source);
  }


  @mutation()
  private REMOVE_AUDIO_SOURCE(sourceId: string) {
    Vue.delete(this.state.audioSources, sourceId);
  }
}

@Mutator()
export class AudioSource extends Source implements IAudioSource {
  fader: IFader;

  @Inject()
  private audioService: AudioService;

  private audioSourceState: IAudioSource;

  constructor(sourceId: string) {
    super(sourceId);
    this.audioSourceState = this.audioService.state.audioSources[sourceId];
    Utils.applyProxy(this, this.audioSourceState);
  }


  setDeflection(deflection: number) {
    const fader = this.audioService.obsFaders[this.sourceId];
    fader.deflection = deflection;
    this.UPDATE(this.audioService.fetchAudioSource(this.name));
  }


  setMul(mul: number) {
    const fader = this.audioService.obsFaders[this.sourceId];
    fader.mul = mul;
    this.UPDATE(this.audioService.fetchAudioSource(this.name));
  }


  setMuted(muted: boolean) {
    this.sourcesService.setMuted(this.sourceId, muted);
  }


  subscribeVolmeter(cb: (volmeter: IVolmeter) => void): Subscription {
    const volmeterStream = new Subject<IVolmeter>();

    let gotEvent = false;
    let lastVolmeterValue: IVolmeter;
    let volmeterCheckTimeoutId: number;
    const obsVolmeter = this.audioService.obsVolmeters[this.sourceId];
    const obsSubscription = obsVolmeter.addCallback((volmeter: IVolmeter) => {
      volmeterStream.next(volmeter);
      lastVolmeterValue = volmeter;
      gotEvent = true;
    });

    function volmeterCheck() {
      if (!gotEvent) {
        volmeterStream.next({ ...lastVolmeterValue, level: 0, peak: 0 });
      }

      gotEvent = false;
      volmeterCheckTimeoutId = setTimeout(volmeterCheck, VOLMETER_UPDATE_INTERVAL * 2);
    }

    volmeterCheck();

    return volmeterStream.subscribe(cb).add(() => {
      clearTimeout(volmeterCheckTimeoutId);
      obsVolmeter.removeCallback(obsSubscription);
    });
  }


  @mutation()
  private UPDATE(patch: { sourceId: string } & Partial<IAudioSource>) {
    Object.assign(this.audioSourceState, patch);
  }

}
