# 仙林校区 3D Tiles 实景三维模型

请将倾斜摄影或激光点云生成的 3D Tiles 数据放置在此目录，并确保根目录存在 `tileset.json`。

## 目录结构示例

```
3dtiles/
├── tileset.json
├── Block/
│   ├── Block_L16_0.b3dm
│   └── ...
└── ...
```

## 配置

路径已在 `config/app.json` 中配置：

```json
"tileset3d": {
  "url": "./3dtiles/tileset.json",
  "enabled": true
}
```

若文件不存在，平台将自动回退到 `Models/campus-model2.glb` 简易模型。
