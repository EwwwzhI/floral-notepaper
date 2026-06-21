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

## 便签编辑

- 支持文字、标题、待办事项和图片等内容。
- 提供加粗、斜体、下划线、撤销与重做等常用编辑能力。
- 支持图片粘贴、导入和对齐调整。
- 自动识别网址、域名和邮箱地址，可直接打开对应链接。
- 支持自动保存，并显示字数、内容块数量及保存状态。

![主窗口截图](Docs/images/主窗口截图.png)

## 快捷便签与桌面磁贴

- 可通过托盘或全局快捷键（默认 `Ctrl+Space`）快速打开独立便签小窗，支持多开。
- 支持同时打开多个快捷便签，并可继续编辑已有内容。
- 便签可转换为常驻桌面的磁贴，支持置顶切换、待办勾选和快速返回编辑。
- 磁贴会根据内容自动调整高度，同时保留手动调整窗口大小的能力。
- 支持记住小窗尺寸，以及在鼠标所在位置附近打开快捷便签。

![小窗口多开示例](Docs/images/小窗口多开示例.png)

## 外观与个性化

- 提供 Everforest 浅色、深色和跟随系统三种主题模式。
- 支持选择系统字体，并分别调整主编辑器和快捷便签字号。
- 支持自定义磁贴颜色。
- 支持设置背景图片及填充、完整显示和平铺模式。

![不同颜色风格示例](Docs/images/不同颜色风格.png)

## 保存与导出

- **保存**：把修改写入花笺的数据目录，供应用继续管理和编辑。
- **导出 Markdown**：将单篇便签另存为 `.md` 文件。图片会复制到同名 `_assets` 文件夹。

数据目录存放便签、图片、背景和应用配置。完整备份或迁移时请复制整个数据目录，不建议直接修改内部文件。

## 下载

目前仅提供 Windows x64 版本，请前往 [GitHub Release](https://github.com/EwwwzhI/floral-notepaper/releases/latest) 下载。

| 类型   | Release 文件                            |
| ------ | --------------------------------------- |
| 便携版 | `floral-notepaper_版本号.exe`           |
| 安装版 | `floral-notepaper_版本号_x64-setup.exe` |

## 从源码构建

环境要求：Node.js 20.19+ 或 22.12+、稳定版 Rust。

```powershell
npm ci
npm run tauri build
```

详细开发说明参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
