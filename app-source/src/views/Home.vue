<template>
  <div class="home-page">
    <div class="home-inner">
      <h1 class="home-title">欢迎来到我们的网站</h1>
      <p class="home-desc">这是占位首页，后续等我们美丽的负责人想想这里写什么新的内容吧~</p>
    </div>
  </div>
</template>

<script setup>
// 首页组件，后续可在这里添加 Hero 动画或介绍内容
</script>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100vh;
  color: #e0e0e0;
  background: #0d0d0d;
  font-family: sans-serif;
  /* 窄屏时给左右留白，并把内容限制在一屏内，避免标题被视口裁掉 */
  padding: 0 20px;
  box-sizing: border-box;
}

.home-inner {
  width: 100%;
  max-width: 720px;
  text-align: center;
}

.home-title {
  /* 关键：字号随视口缩放，而不是固定 24px + 元素自身宽度随内容撑开。
     390px 下 clamp 会取到约 24px，桌面端最大 40px，任何宽度都不会溢出。 */
  font-size: clamp(20px, 6vw, 40px);
  line-height: 1.3;
  margin: 0 0 16px;
  /* 中文长标题允许在任意字符间断行，避免整串被当成一个不可分单词 */
  word-break: break-word;
}

.home-desc {
  font-size: clamp(13px, 3.6vw, 16px);
  line-height: 1.7;
  margin: 0;
  color: #9a9a9a;
  word-break: break-word;
}
</style>
