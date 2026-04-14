/**
 * 创蓝253短信发送模块
 * 模板：验证码：{s}，10分钟内有效（模板ID: 1021758231）
 */
const crypto = require('crypto');

const SMS_ACCOUNT = process.env.SMS_ACCOUNT || 'YZM944425_YZM0112155';
const SMS_PASSWORD = process.env.SMS_PASSWORD || 'Hff111G2tK33d8';
const SMS_TEMPLATE_ID = process.env.SMS_TEMPLATE_ID || '1021758231';
const SMS_API_URL = 'https://smssh.253.com/msg/sms/v2/tpl/send';

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function makeNonce() {
  return crypto.randomBytes(16).toString('hex');
}

function makeSignature(md5Password, timestamp, nonce) {
  const arr = [md5Password, timestamp, nonce].sort();
  const str = arr.join('');
  return crypto.createHmac('sha256', md5Password).update(str).digest('hex');
}

/**
 * 发送验证码短信
 * @param {string} phone 11位手机号
 * @param {string} code 验证码
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendSmsCode(phone, code) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = makeNonce();
  const md5pwd = md5(SMS_PASSWORD);
  const signature = makeSignature(md5pwd, timestamp, nonce);

  const body = {
    account: SMS_ACCOUNT,
    nonce,
    timestamp,
    phoneNumbers: phone,
    templateId: SMS_TEMPLATE_ID,
    templateParamJson: JSON.stringify([{ param1: code }]),
    report: 'true'
  };

  try {
    const fetch = require('node-fetch');
    const res = await fetch(SMS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-QA-Hmac-Signature': signature
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    console.log(`[SMS] 响应: ${JSON.stringify(data)}`);
    if (data.code === '000000') {
      console.log(`[SMS] 验证码已发送 phone=${phone} msgId=${data.msgId}`);
      return { success: true };
    } else {
      console.error(`[SMS] 发送失败 code=${data.code} msg=${data.errorMsg}`);
      return { success: false, error: data.errorMsg || `错误码: ${data.code}` };
    }
  } catch (err) {
    console.error('[SMS] 请求异常:', err.message);
    return { success: false, error: '短信服务暂时不可用' };
  }
}

module.exports = { sendSmsCode };
