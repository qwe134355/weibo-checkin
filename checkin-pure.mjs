/**
 * 微博超话签到 - 智能自动修复版
 * Cookie过期自动登录刷新，无需手动干预
 */

const SUPER_TOPIC_ID = process.env.SUPER_TOPIC_ID || '1008089e28e16dc078315dffce410da0740f3a';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 10000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatTime(d) {
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// ====== HTTP签到 ======
async function httpCheckin(cookieStr) {
  const params = new URLSearchParams({
    scene_id: 'pc_checkin',
    page_id: SUPER_TOPIC_ID,
    timezone: 'Asia/Shanghai',
    lang: 'zh-cn',
    plat: 'Win32',
    ua: 'Mozilla/5.0'
  });

  const res = await fetch('https://weibo.com/ajax_proxy/chaohua/page/checkin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://weibo.com/p/' + SUPER_TOPIC_ID
    },
    body: params.toString()
  });
  return await res.json();
}

// ====== 检查是否已签到 ======
function isCheckedIn(data) {
  return data.code === 100000 ||
    data.code === 382004 ||
    (data.msg && data.msg.includes('已签到'));
}

function isCookieExpired(data) {
  return data.code === 100003;
}

// ====== 安装Playwright（按需安装） ======
async function ensurePlaywright() {
  try {
    await import('playwright');
    return true;
  } catch(e) {
    console.log('📦 正在安装 Playwright（用于Cookie过期自动登录）...');
    const { execSync } = await import('child_process');
    try {
      execSync('npm install playwright --no-audit --no-fund 2>&1', { stdio: 'pipe', timeout: 120000 });
      console.log('  ✅ Playwright 安装完成');
    } catch(e2) {
      console.log('  ⚠️ npm install 失败: ' + e2.message);
      return false;
    }
    try {
      execSync('npx playwright install chromium 2>&1', { stdio: 'pipe', timeout: 180000 });
      console.log('  ✅ Chromium 安装完成');
      return true;
    } catch(e3) {
      console.log('  ⚠️ Chromium 安装失败: ' + e3.message);
      return false;
    }
  }
}

// ====== Playwright自动登录 ======
async function autoLogin() {
  const username = process.env.WEIBO_USERNAME;
  const password = process.env.WEIBO_PASSWORD;

  if (!username || !password) {
    console.log('  ❌ 未配置微博账号（需设置 WEIBO_USERNAME/WEIBO_PASSWORD）');
    return false;
  }

  const pwReady = await ensurePlaywright();
  if (!pwReady) {
    console.log('  ❌ Playwright 不可用，无法自动登录');
    return false;
  }

  try {
    console.log('  🌐 启动浏览器自动登录...');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN'
    });

    const page = await context.newPage();
    console.log('  🔑 正在登录微博...');

    // 打开登录页
    await page.goto('https://passport.weibo.com/signin/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 填账号
    const usernameInput = await page.$('#loginname') || await page.$('input[name="username"]');
    if (usernameInput) {
      await usernameInput.click();
      await usernameInput.fill('');
      await usernameInput.type(username, { delay: 50 });
    }

    // 填密码
    const passwordInput = await page.$('input[type="password"]');
    if (passwordInput) {
      await passwordInput.click();
      await passwordInput.fill('');
      await passwordInput.type(password, { delay: 30 });
    }

    // 点登录
    const loginBtn = await page.$('a[action-type="btn_submit"], .W_btn_a');
    if (loginBtn) await loginBtn.click();
    else await page.keyboard.press('Enter');

    // 等待登录结果
    await page.waitForTimeout(10000);

    const afterUrl = page.url();
    if (!afterUrl.includes('passport')) {
      console.log('  ✅ 登录成功！');
      const cookies = await context.cookies();
      const newCookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
      // 保存到文件供后续重试使用
      const fs = await import('fs');
      fs.writeFileSync('cookies.txt', newCookieStr, 'utf-8');
      console.log('  📂 Cookie已保存，继续签到...');
      await browser.close();
      return newCookieStr;
    }

    // 验证码
    console.log('  ⚠️ 遇到验证码，自动登录失败');
    try { await page.screenshot({ path: 'login-captcha.png' }); } catch(e) {}
    await browser.close();
    return null;

  } catch (err) {
    console.error('  ❌ 自动登录出错: ' + err.message);
    return null;
  }
}

// ====== 主流程 ======
async function main() {
  console.log('📅 微博超话签到 - ' + formatTime(new Date()));
  console.log('📌 张杰超话');
  console.log('');

  let cookieStr = process.env.WEIBO_COOKIES || '';

  // 先从文件加载备用Cookie
  try {
    const fs = await import('fs');
    if (fs.existsSync('cookies.txt')) {
      const fileCookie = fs.readFileSync('cookies.txt', 'utf-8').trim();
      if (fileCookie) {
        cookieStr = fileCookie;
        console.log('📂 使用本地Cookie文件');
      }
    }
  } catch(e) {}

  if (!cookieStr) {
    console.log('🔄 无可用Cookie，尝试自动登录...');
    cookieStr = await autoLogin();
    if (!cookieStr) {
      console.log('❌ 无法获取Cookie');
      process.exit(1);
    }
  }

  // 签到重试循环
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log('⏳ 第' + attempt + '次重试...');
      await sleep(RETRY_DELAY_MS);
    }

    try {
      const data = await httpCheckin(cookieStr);
      console.log('📡 响应: ' + JSON.stringify(data));

      if (isCheckedIn(data)) {
        console.log('✅ 签到成功！' + (data.title || '今天已签到 ✨'));
        // 如果用的是本地Cookie，同步到环境变量供下次使用
        try {
          const fs = await import('fs');
          if (fs.existsSync('cookies.txt')) {
            fs.writeFileSync('cookies.txt', cookieStr, 'utf-8');
          }
        } catch(e) {}
        process.exit(0);
      }

      if (isCookieExpired(data)) {
        console.log('⚠️ Cookie已过期，尝试自动登录刷新...');
        const newCookie = await autoLogin();
        if (newCookie) {
          cookieStr = newCookie;
          console.log('🔄 新Cookie获取成功，重试签到...');
          continue;
        } else {
          console.log('❌ 自动登录失败（可能需要手动登录一次微博）');
          process.exit(1);
        }
      }

      console.warn('⚠️ 临时失败(code=' + data.code + '), 重试...');
    } catch (err) {
      console.error('❌ 请求出错: ' + err.message);
      if (attempt < MAX_RETRIES) console.warn('⚠️ 网络异常, 重试...');
    }
  }

  console.log('❌ 重试耗尽，签到失败');
  process.exit(1);
}

main();
