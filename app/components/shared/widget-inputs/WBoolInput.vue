<template>
<div class="input-container">
  <div class="input-wrapper">
    <div class="checkbox" @click="handleClick">
      <input
        type="checkbox"
        :checked="value"
      />
      <label>{{ title }}</label>
    </div>
  </div>
</div>
</template>

<script lang="ts" src="./WBoolInput.vue.ts"></script>
