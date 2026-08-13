<template>
  <main class="login-shell">
    <section class="login-card" aria-labelledby="login-title">
      <div class="brand-mark" aria-hidden="true">S</div>
      <div class="login-heading">
        <span>SKYNEST ACCESS</span>
        <h1 id="login-title">登录低空配送平台</h1>
        <p>登录身份将决定可查看的工作台和可执行的操作。</p>
      </div>

      <div v-if="loginOptions.demo_mode && loginOptions.roles?.length" class="demo-accounts">
        <span>本地演示账号</span>
        <div>
          <button
            v-for="account in loginOptions.roles"
            :key="account.role"
            type="button"
            @click="selectDemoAccount(account)"
          >
            <b>{{ account.role_label }}</b>
            <small>{{ account.username }}</small>
          </button>
        </div>
      </div>

      <form @submit.prevent="submitLogin">
        <label>
          <span>账号</span>
          <input v-model.trim="username" name="username" autocomplete="username" placeholder="请输入账号" required />
        </label>
        <label>
          <span>密码</span>
          <input v-model="password" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required />
        </label>
        <p v-if="error" class="login-error" role="alert">{{ error }}</p>
        <button class="login-button" type="submit" :disabled="loading || !username || !password">
          {{ loading ? '正在登录…' : '登录并进入工作台' }}
        </button>
      </form>

      <p class="security-note">登录会话默认保留 8 小时；退出后当前凭证立即失效。</p>
    </section>
  </main>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { demoApi } from '../services/demoApi'

const emit = defineEmits(['authenticated'])
const username = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')
const loginOptions = ref({ demo_mode: false, roles: [] })

function selectDemoAccount(account) {
  username.value = account.username
  password.value = account.demo_password || ''
  error.value = account.demo_password ? '' : '该账号已配置独立密码，请输入实际密码。'
}

async function submitLogin() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const session = await demoApi.login(username.value, password.value)
    emit('authenticated', session)
  } catch (loginError) {
    error.value = loginError.message || '登录失败，请检查账号和密码。'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    loginOptions.value = await demoApi.getLoginOptions()
  } catch (loadError) {
    error.value = `登录服务暂不可用：${loadError.message}`
  }
})
</script>

<style scoped>
.login-shell {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  padding: 24px;
  color: #eaf4ff;
  background:
    radial-gradient(circle at 25% 20%, rgba(33, 150, 243, 0.22), transparent 32%),
    radial-gradient(circle at 80% 75%, rgba(0, 188, 212, 0.14), transparent 30%),
    rgba(3, 10, 23, 0.96);
  backdrop-filter: blur(18px);
}

.login-card {
  width: min(430px, 100%);
  box-sizing: border-box;
  padding: 30px;
  background: linear-gradient(155deg, rgba(14, 34, 64, 0.98), rgba(8, 19, 38, 0.98));
  border: 1px solid rgba(144, 202, 249, 0.32);
  border-radius: 20px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.48);
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: 18px;
  color: #061426;
  background: linear-gradient(135deg, #90caf9, #4dd0e1);
  border-radius: 13px;
  font-size: 24px;
  font-weight: 900;
  box-shadow: 0 10px 30px rgba(79, 195, 247, 0.22);
}

.login-heading > span { color: #4fc3f7; font-size: 10px; font-weight: 700; letter-spacing: 2px; }
.login-heading h1 { margin: 6px 0 8px; font-size: 24px; }
.login-heading p { margin: 0; color: #9fb2c8; font-size: 13px; line-height: 1.6; }

.demo-accounts { margin: 22px 0 18px; }
.demo-accounts > span { display: block; margin-bottom: 8px; color: #78909c; font-size: 11px; }
.demo-accounts > div { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.demo-accounts button {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 9px 7px;
  color: #dbe9f7;
  background: rgba(79, 195, 247, 0.07);
  border: 1px solid rgba(79, 195, 247, 0.18);
  border-radius: 9px;
  cursor: pointer;
}
.demo-accounts button:hover { background: rgba(79, 195, 247, 0.15); border-color: rgba(79, 195, 247, 0.42); }
.demo-accounts b { font-size: 11px; }
.demo-accounts small { overflow: hidden; color: #78909c; font-size: 9px; text-overflow: ellipsis; }

form { display: grid; gap: 13px; }
label { display: grid; gap: 6px; text-align: left; }
label span { color: #b8c8d9; font-size: 12px; }
input {
  box-sizing: border-box;
  width: 100%;
  padding: 11px 12px;
  color: #edf6ff;
  background: rgba(2, 10, 24, 0.65);
  border: 1px solid rgba(144, 202, 249, 0.2);
  border-radius: 9px;
  outline: none;
}
input:focus { border-color: #4fc3f7; box-shadow: 0 0 0 3px rgba(79, 195, 247, 0.1); }
.login-button {
  margin-top: 3px;
  padding: 11px;
  color: #061426;
  background: linear-gradient(135deg, #90caf9, #4dd0e1);
  border: 0;
  border-radius: 9px;
  font-weight: 800;
  cursor: pointer;
}
.login-button:disabled { opacity: 0.55; cursor: not-allowed; }
.login-error { margin: 0; padding: 8px 10px; color: #ffccbc; background: rgba(244, 67, 54, 0.12); border-radius: 7px; font-size: 11px; }
.security-note { margin: 17px 0 0; color: #607d8b; font-size: 10px; text-align: center; }

@media (max-width: 520px) {
  .login-card { padding: 22px; }
  .demo-accounts > div { grid-template-columns: 1fr; }
  .demo-accounts button { flex-direction: row; justify-content: space-between; }
}
</style>
