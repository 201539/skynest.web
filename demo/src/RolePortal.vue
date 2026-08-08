<template>
  <main class="portal-shell">
    <section class="portal-hero">
      <div class="brand"><span class="brand-mark">S</span><span>SkyNest</span></div>
      <p class="eyebrow">校园低空配送服务平台</p>
      <h1>选择你的服务入口</h1>
      <p class="subtitle">同一任务链路，分别服务需求方、履约方与校园管理方。</p>
    </section>

    <section class="role-grid" aria-label="角色入口">
      <button class="role-card student" type="button" @click="enter('/student/')">
        <span class="role-icon">学</span>
        <span class="role-content"><strong>学生端</strong><small>提交配送需求 · 查看进度 · 到达取件</small></span>
        <span class="arrow">→</span>
      </button>
      <button class="role-card enterprise" type="button" @click="enter('/enterprise/')">
        <span class="role-icon">企</span>
        <span class="role-content"><strong>企业端</strong><small>承接合规任务 · 运力匹配 · 回传履约状态</small></span>
        <span class="arrow">→</span>
      </button>
      <button class="role-card school" type="button" @click="enter('/?role=school')">
        <span class="role-icon">校</span>
        <span class="role-content"><strong>校方端</strong><small>审核校园任务 · 管理低空通道 · 三维态势查看</small></span>
        <span class="arrow">→</span>
      </button>
    </section>

    <section class="platform-note">
      <strong>平台定位</strong>
      <p>SkyNest 提供校园需求编排、空间适配与多方协同服务；无人机和飞控能力由合作企业提供。</p>
    </section>
    <footer>校企协同 · 数据驱动 · 开放接口</footer>
  </main>
</template>

<script setup>
function enter(path) {
  window.location.assign(path)
}
</script>

<style scoped>
:global(*) { box-sizing: border-box; }
:global(body) { margin: 0; min-width: 320px; min-height: 100vh; background: #edf3f4; font-family: "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }
:global(button) { font: inherit; }
.portal-shell { min-height: 100vh; padding: 42px max(20px, calc((100vw - 980px) / 2)) 28px; color: #15364a; background: radial-gradient(circle at 88% 5%, rgba(92, 198, 186, .22), transparent 28%), linear-gradient(145deg, #f7fbfa, #e7f0f2); }
.portal-hero { max-width: 700px; }
.brand { display: flex; align-items: center; gap: 9px; color: #0c5064; font-size: 18px; font-weight: 800; letter-spacing: .5px; }
.brand-mark { display: grid; width: 31px; height: 31px; place-items: center; border-radius: 10px; background: #176d7a; color: #fff; }
.eyebrow { margin: 42px 0 8px; color: #3a7f87; font-size: 13px; font-weight: 700; letter-spacing: 1.8px; }
h1 { margin: 0; color: #0b3049; font-size: clamp(31px, 5vw, 50px); line-height: 1.14; }
.subtitle { max-width: 580px; margin: 16px 0 0; color: #5b7480; font-size: 16px; line-height: 1.7; }
.role-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 38px; }
.role-card { display: grid; min-height: 184px; grid-template-columns: 48px 1fr auto; align-content: center; align-items: center; gap: 13px; padding: 24px 20px; border: 1px solid rgba(44, 91, 106, .13); border-radius: 22px; cursor: pointer; text-align: left; box-shadow: 0 12px 34px rgba(38, 72, 84, .08); transition: transform .2s ease, box-shadow .2s ease; }
.role-card:hover { transform: translateY(-4px); box-shadow: 0 18px 40px rgba(29, 77, 88, .14); }
.role-card.student { background: linear-gradient(145deg, #ffffff, #e8f7f4); }
.role-card.enterprise { background: linear-gradient(145deg, #ffffff, #edf2ff); }
.role-card.school { background: linear-gradient(145deg, #ffffff, #eaf2f8); }
.role-icon { display: grid; width: 46px; height: 46px; place-items: center; border-radius: 15px; color: #fff; font-size: 18px; font-weight: 800; }
.student .role-icon { background: #188b7f; }
.enterprise .role-icon { background: #526eb3; }
.school .role-icon { background: #235b84; }
.role-content { display: grid; gap: 7px; }
.role-content strong { color: #153b51; font-size: 21px; }
.role-content small { color: #647b86; font-size: 13px; line-height: 1.55; }
.arrow { color: #6e8993; font-size: 23px; }
.platform-note { max-width: 760px; margin-top: 25px; padding: 17px 19px; border-left: 3px solid #30958c; border-radius: 0 13px 13px 0; background: rgba(255,255,255,.58); }
.platform-note strong { color: #236b70; font-size: 13px; }
.platform-note p { margin: 6px 0 0; color: #57717c; font-size: 13px; line-height: 1.65; }
footer { margin-top: 38px; color: #789099; font-size: 12px; letter-spacing: 1px; }
@media (max-width: 760px) { .portal-shell { padding-top: 27px; } .eyebrow { margin-top: 31px; } .role-grid { grid-template-columns: 1fr; margin-top: 28px; } .role-card { min-height: 126px; } }
</style>
