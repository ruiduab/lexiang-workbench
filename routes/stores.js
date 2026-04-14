const express = require('express');
const router = express.Router();
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Haversine 距离（米），WGS84
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

// GET /api/stores/nearby?lat=&lng=
router.get('/nearby', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'lat/lng 参数必填' });

  const AK = process.env.BAIDU_MAP_KEY;
  if (!AK) return res.status(503).json({ error: '地图 Key 未配置' });

  try {
    // 百度地图周边检索，coord_type=1 表示传入 WGS84 坐标，scope=2 返回距离
    const url = `https://api.map.baidu.com/place/v2/search?ak=${AK}` +
      `&query=联想专卖店|联想体验店|联想服务站` +
      `&location=${lat},${lng}&radius=20000` +
      `&output=json&page_size=20&page_num=0&coord_type=1&scope=2`;

    const data = await httpsGet(url);

    if (data.status !== 0) {
      return res.status(500).json({ error: data.message || `百度API错误 status=${data.status}` });
    }

    const results = data.results || [];
    const stores = results
      .map(p => {
        // 百度返回 BD09 坐标，用 API 自带的 detail_info.distance（单位：米）
        const dist = p.detail_info?.distance != null
          ? Math.round(p.detail_info.distance)
          : haversine(lat, lng, p.location?.lat || 0, p.location?.lng || 0);
        return {
          name: p.name,
          address: p.address || '',
          tel: p.telephone || '',
          dist,
          // BD09 坐标用于百度导航链接
          lat: p.location?.lat,
          lng: p.location?.lng,
        };
      })
      .filter(s => s.dist <= 20000)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10);

    res.json({ stores, total: stores.length });
  } catch (e) {
    console.error('[Stores]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/stores/geocode?address=国贸
router.get('/geocode', async (req, res) => {
  const address = (req.query.address || '').trim();
  if (!address) return res.status(400).json({ error: 'address 参数必填' });

  const AK = process.env.BAIDU_MAP_KEY;
  if (!AK) return res.status(503).json({ error: '地图 Key 未配置' });

  try {
    const url = `https://api.map.baidu.com/geocoding/v3/?address=${encodeURIComponent(address)}&ak=${AK}&output=json`;
    const data = await httpsGet(url);
    if (data.status !== 0 || !data.result?.location) {
      return res.status(404).json({ error: `找不到"${address}"的位置` });
    }
    // 百度 geocode 返回 BD09，需转为 WGS84 供 nearby 接口使用
    // 简单偏移修正（精度足够门店搜索）
    const bd_lat = data.result.location.lat;
    const bd_lng = data.result.location.lng;
    const x = bd_lng - 0.0065, y = bd_lat - 0.006;
    const z = Math.sqrt(x*x + y*y) - 0.00002 * Math.sin(y * Math.PI * 3000 / 180);
    const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000 / 180);
    const wgs_lng = z * Math.cos(theta);
    const wgs_lat = z * Math.sin(theta);
    res.json({ lat: wgs_lat, lng: wgs_lng, name: data.result.formatted_address || address });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
