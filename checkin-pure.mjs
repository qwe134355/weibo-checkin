/**
 * 微博超话签到 - 智能版
 * 支持Cookie过期自动登录刷新
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

// ====== 主流程 ======
async function main() {
  console.log('📅 微博超话签到 - ' + formatTime(new Date()));
  console.log('📌 张杰超话');
  console.log('');

  let cookieStr = process.env.WEIBO_COOKIES;

  if (!cookieStr) {
    console.log('❌ 未设置 WEIBO_COOKIES');
    // 尝试从文件加载（Playwright刷新后保存）
    try {
      const fs = await import('fs');
      if (fs.existsSync('cookies.txt')) {
        cookieStr = fs.readFileSync('cookies.txt', 'utf-8').trim();
        console.log('📂 从文件加载了Cookie');
      }
    } catch(e) {}
  }

  if (!cookieStr) {
    console.log('🔄 无可用Cookie，尝试自动登录...');
    const ok = await autoLogin();
    if (!ok) { process.exit(1); }
    // 重新加载Cookie
    const fs = await import('fs');
    cookieStr = fs.readFileSync('cookies.txt', 'utf-8').trim();
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

      // 签到成功
      if (data.code === 100000) {
        console.log('✅ 签到成功！' + (data.title || ''));
        process.exit(0);
        return;
      }

      // 已签到
      if (data.code === 382004 || (data.msg && data.msg.includes('已签到'))) {
        console.log('✅ 今天已签到 ✨');
        process.exit(0);
        return;
      }

      // Cookie过期 → 自动登录
      if (data.code === 100003) {
        console.log('⚠️ Cookie已过期，尝试自动登录刷新...');
        const ok = await autoLogin();
        if (ok) {
          console.log('🔄 登录成功，重新尝试签到...');
          const fs = await import('fs');
          cookieStr = fs.readFileSync('cookies.txt', 'utf-8').trim();
          continue;
        } else {
          console.log('❌ 自动登录失败（可能需要手动处理验证码）');
          process.exit(1);
        }
      }

      // 其他错误，重试
      console.warn('⚠️ 临时失败(code=' + data.code + '), 重试...');
    } catch (err) {
      console.error('❌ 请求出错: ' + err.message);
      if (attempt < MAX_RETRIES) console.warn('⚠️ 网络异常, 重试...');
    }
  }

  console.log('❌ 重试耗尽，签到失败');
  process.exit(1);
}

// ====== Playwright自动登录 ======
async function autoLogin() {
  const username = process.env.WEIBO_USERNAME;
  const password = process.env.WEIBO_PASSWORD;

  if (!username || !password) {
    console.log('❌ 未配置微博账号密码（WEIBO_USERNAME/WEIBO_PASSWORD）');
    return false;
  }

  try {
    console.log('🌐 启动浏览器自动登录...');
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN'
    });

    const page = await context.newPage();
    console.log('🔑 正在打开登录页面...');

    // 先试一下Cookie是否还能用（可能只是部分过期）
    try {
      await page.goto('https://weibo.com/p/' + SUPER_TOPIC_ID, { waitUntil: 'networkidle', timeout: 20000 });
      const url = page.url();
      if (!url.includes('passport') && !url.includes('login')) {
        console.log('✅ 当前会话仍有效，保存Cookie...');
        const cookies = await context.cookies();
        const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
        const fs = await import('fs');
        fs.writeFileSync('cookies.txt', cookieStr, 'utf-8');
        await browser.close();
        return true;
      }
    } catch(e) {
      console.log('⏩ 会话已过期，重新登录...');
    }

    // 打开登录页
    await page.goto('https://passport.weibo.com/signin/login', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 填账号
    const usernameInput = await page.$('#loginname') || await page.$('input[name="username"]');
    if (usernameInput) {
      await usernameInput.click();
      await usernameInput.fill('');
      await usernameInput.type(username, { delay: 50 });
      console.log('✅ 已填写账号');
    }

    // 填密码
    const passwordInput = await page.$('input[type="password"]') || await page.$('input[name="password"]');
    if (passwordInput) {
      await passwordInput.click();
      await passwordInput.fill('');
      await passwordInput.type(password, { delay: 30 });
      console.log('✅ 已填写密码');
    }

    // 点登录按钮
    const loginBtn = await page.$('a[action-type="btn_submit"], button[node-type="submit"], .W_btn_a');
    if (loginBtn) {
      await loginBtn.click();
      console.log('🔄 正在登录...');
    } else {
      // 可能页面结构不同，直接提交
      await page.keyboard.press('Enter');
    }

    // 等待登录结果
    await page.waitForTimeout(8000);

    const afterUrl = page.url();
    if (!afterUrl.includes('passport')) {
      console.log('✅ 登录成功！');
      // 保存Cookie
      const cookies = await context.cookies();
      const newCookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
      const fs = await import('fs');
      fs.writeFileSync('cookies.txt', newCookieStr, 'utf-8');
      console.log('📂 Cookie已保存');
      await browser.close();
      return true;
    }

    // 可能遇到验证码，截图保存
    try {
      await page.screenshot({ path: 'login_captcha.png' });
      console.log('📸 遇到验证码，截图已保存');
    } catch(e) {}

    console.log('❌ 登录失败，可能遇到验证码');
    await browser.close();
    return false;

  } catch (err) {
    console.error('❌ Playwright登录出错: ' + err.message);
    return false;
  }
}

main();
