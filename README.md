<!-- markdownlint-disable -->

<div align="center">

<img src="./src-tauri/icons/icon.png" width="112" alt="花笺图标">

# 花笺 Floral Notepaper

轻量、现代的 Windows 本地便签工具<br>
基于 Tauri 2 + React 构建

[下载](https://github.com/EwwwzhI/floral-notepaper/releases/latest) · [反馈问题](https://github.com/EwwwzhI/floral-notepaper/issues) · [更新日志](https://github.com/EwwwzhI/floral-notepaper/releases)

[![Version](https://img.shields.io/github/v/release/EwwwzhI/floral-notepaper)](https://github.com/EwwwzhI/floral-notepaper/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

<!-- markdownlint-restore -->

## 功能

- 文字、待办、图片、加粗、斜体和下划线编辑
- 快捷键唤出便签小窗，继续编辑已有便签
- 磁贴置顶、非置顶切换、待办勾选与快速返回编辑
- 自动识别网址、域名和邮箱链接
- 导出 Markdown，并同步导出关联图片
- Everforest 浅色、深色及跟随系统主题
- 数据完全保存在本地

![主窗口截图](Docs/images/主窗口截图.png)

## 快捷便签与磁贴

通过托盘或全局快捷键（默认 `Ctrl+Shift+N`）打开快捷便签。

![小窗多开示例](Docs/images/小窗多开示例.gif)

![磁贴示例](Docs/images/AI绘画截图.png)

## 保存与导出

- **保存**：把修改写入花笺的数据目录，供应用继续管理和编辑。
- **导出 Markdown**：将单篇便签另存为 `.md` 文件。图片会复制到同名 `_assets` 文件夹。

数据目录存放便签、图片、背景和应用配置。完整备份或迁移时请复制整个数据目录，不建议直接修改内部文件。

## 下载

目前仅提供 Windows x64 版本，请前往 [GitHub Release](https://github.com/EwwwzhI/floral-notepaper/releases/latest) 下载。

| 类型   | Release 文件                            |
| ------ | --------------------------------------- |
| 安装版 | `floral-notepaper_版本号_x64-setup.exe` |
| 便携版 | `floral-notepaper_版本号.exe`           |

## 从源码构建

环境要求：Node.js 20.19+ 或 22.12+、稳定版 Rust。

```powershell
npm ci
npm run tauri build
```

详细开发说明参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
