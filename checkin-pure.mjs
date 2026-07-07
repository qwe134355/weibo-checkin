/**
 * 微博超话签到 - 纯 HTTP 版（无需浏览器）
 * 用于 GitHub Actions / 云函数等环境
 * Cookie 从环境变量 WEIBO_COOKIES 读取
 */

const SUPER_TOPIC_ID = '1008089e28e16dc078315dffce410da0740f3a'; // 张杰超话
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 30000;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function checkin() {
  const cookieStr = process.env.WEIBO_COOKIES;
  if (!cookieStr) {
    console.error('❌ 错误: 未设置 WEIBO_COOKIES 环境变量');
    process.exit(1);
  }

  console.log('📅 微博超话签到 - ' + new Date().toLocaleString('zh-CN'));
  console.log('📌 张杰超话');

  const params = new URLSearchParams({
    scene_id: 'pc_checkin',
    page_id: SUPER_TOPIC_ID,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
    lang: 'zh-cn',
    plat: 'Win32',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log('⏳ 第 ' + attempt + ' 次重试...');
      await sleep(RETRY_DELAY_MS);
    }

    try {
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

      const data = await res.json();
      console.log('📡 响应: ' + JSON.stringify(data));

      if (data.code === 100000) {
        console.log('✅ 签到成功！');
        return true;
      }
      if (data.code === 382004 || (data.msg && data.msg.includes('已签到'))) {
        console.log('✅ 今天已签到');
        return true;
      }
      if (data.code === 100003) {
        console.error('❌ Cookie 过期');
        return false;
      }
      // 临时失败继续重试
      console.warn('⚠️ 临时失败(code=' + data.code + '), 重试...');
    } catch (err) {
      console.error('❌ 请求出错: ' + err.message);
      if (attempt < MAX_RETRIES) console.warn('⚠️ 网络异常, 重试...');
    }
  }
  console.error('❌ 重试耗尽, 签到失败');
  return false;
}

checkin().then(ok => process.exit(ok ? 0 : 1));