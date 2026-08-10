# 股票自选工具（共振雷达）

A 股趋势与量价共振筛选工具，保留盘中候选、自选、收盘确认、时间筛选、市值筛选、严格匹配与接近匹配等功能。

## 策略条件

- 均线多头排列
- MACD 零轴上方金叉
- 成交量放大
- 支持 300 亿以内、300 亿以上市值筛选

## 数据来源

- 网页服务：东方财富为主，腾讯行情作为备用
- Python 数据服务：AKShare 提供行情备用，Baostock 提供历史日 K 备用

免费公开数据源可能存在限流、延迟或接口变化。本工具仅用于信息筛选，不构成投资建议。

## Render 部署 Python 数据服务

1. 把本项目上传到 GitHub。
2. 登录 Render，选择 `New +` → `Blueprint`。
3. 选择本仓库，Render 会读取根目录 `render.yaml`。
4. 部署完成后记录服务地址，例如 `https://stock-resonance-data.onrender.com`。
5. 打开该地址的 `/health`，返回 `ok` 即表示服务正常。

Render 免费实例长时间无人访问后可能休眠，首次请求通常需要等待唤醒。

## 网页端接入 Python 服务

为网页运行环境添加环境变量：

```text
PYTHON_DATA_API=https://你的-render-服务地址
```

不要在结尾添加 `/`。设置后重新部署网页。

## 本地启动 Python 服务

```bash
cd python-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

接口：

- `GET /health`
- `GET /api/quotes`
- `GET /api/history/{股票代码}`

## 本地启动网页

需要 Node.js 22 或更高版本：

```bash
npm install
npm run dev
```

