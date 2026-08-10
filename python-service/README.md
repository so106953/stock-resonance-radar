# Python 行情补充服务

为共振雷达提供免注册数据源：

- Baostock：历史日K主备用，前复权。
- AKShare：历史日K二级备用及全市场行情补充。
- FastAPI：统一HTTP接口、内存缓存和健康检查。

## Render部署

在Render创建Blueprint或Web Service，仓库根目录选择本项目，Blueprint文件选择 `python-service/render.yaml`。

部署成功后，将Render服务地址配置到网页服务环境变量：

```text
PYTHON_DATA_API=https://你的服务.onrender.com
```

接口：`GET /health`、`GET /api/quotes`、`GET /api/history/{code}`。
