# 隐私政策 / Privacy Policy

生效日期：2026-10-27。适用于「雨课堂 · 平铺学习助手」0.3.1 及后续版本。开发者：Daucloud。项目与联系方式：[GitHub Issues](https://github.com/Daucloud/yuketang-rush/issues)。本扩展是独立开源项目，与雨课堂及课程提供方无官方隶属关系。

## 功能与数据用途

本扩展提供课程学习工作区：组织雨课堂视频的静音播放队列，并在用户主动点击分析时生成客观题学习建议。不会自动选择答案或提交作业。

仅处理功能所需的数据：

| 数据 | 用途与去向 |
| --- | --- |
| 所选课程单元的标题、网址、完成标记 | 在 Chrome 本地保存待选列表与队列；网址可能包含课程和单元标识 |
| 播放时间、倍速、暂停状态、页面可见性和焦点、运行错误 | 本地诊断与播放状态展示，每项任务最多保留最近 180 条记录 |
| 客观题题干、选项及其渲染图片 | 用户主动分析时，直接发给用户配置的模型 API；不发送整页截图、Cookie 或完整浏览记录 |
| 模型答案、解释、题号、时间与题面指纹 | Chrome 本地缓存，最多保留最近 10 份作业的文字建议，不缓存题面图片 |
| 模型 API 基地址、模型名称与 API key | Chrome 本地保存；API key 作为认证信息仅发送到用户配置并授权的模型 API 站点 |

不读取其他网站的浏览历史，不采集课程账号密码、Cookie、支付信息、通讯录或设备的精确位置。不安装广告或第三方统计追踪工具。

## 外部传输

开发者不运营接收题面、密钥或播放记录的服务器。模型分析由扩展直接请求用户选定的 API。该提供商会接收到上述题面与认证信息，以及正常网络请求包含的 IP 地址和请求元数据；其保存期限、训练用途及跨境处理取决于该提供商的隐私政策。请在配置前了解并选择可信的提供商。

连接测试仅发送一张空白示例图片和测试文字。视频队列不调用模型服务。扩展打开的课程页面仍会按雨课堂自身的机制与其服务器通信，其隐私规则另行适用。

## 本地保存、控制与删除

密钥、课程队列、候选列表与答案缓存使用 AES-256-GCM 加密后保存在 `chrome.storage.local`，不使用 `chrome.storage.sync`。加密使用的不可导出 CryptoKey 保存在扩展自身的 IndexedDB 中，不与密文共同放在 Chrome 本地存储。API key 不回显，内容脚本无法直接读取该本地存储。此措施不替代操作系统账号和设备的安全保护。旧版明文记录在新版启动时迁移为加密记录。

用户可取消分析或清除当前作业建议；修改模型设置会取消旧分析并清除答案缓存；「删除已保存的密钥与设置」删除模型配置、密钥和答案缓存。队列及候选单元记录保留在本地，开始新队列会替换队列记录。卸载扩展可移除其 Chrome 本地存储。

用户主动点击「导出本地播放记录」时，扩展在本机生成包含任务标题及播放诊断的 JSON 文件，不包含 API key；由用户自行决定是否分享。删除本地数据不会删除模型提供商已经接收的数据，请联系提供商处理。

## 限制使用与政策

本扩展对用户数据的使用和转移遵守 [Chrome Web Store 用户数据政策](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)，包括其中的 Limited Use（限制使用）要求。数据仅用于用户可见的学习辅助功能，不出售、不用于广告或无关用途，也不用于评估信用或提供贷款服务。

如发生数据处理方式变化，将更新本文件和扩展说明。如需反馈或提出隐私问题，请使用上方项目联系方式，并避免在公开 Issue 中粘贴密钥或个人课程记录。

## English summary

This independent open-source extension organizes Yuketang video playback and provides AI study advice on user request. Selected course URLs/titles, playback diagnostics, model configuration/API keys, and up to ten worksheets of text advice are encrypted with AES-256-GCM and stored locally in Chrome, without browser sync. The non-extractable encryption key is kept in the extension’s IndexedDB origin. Rendering images are not cached. Content scripts cannot directly read the local storage.

When the user requests analysis, question/option images and the API key used for authentication are sent directly to the user-selected model API. The provider also receives normal network metadata and applies its own retention and privacy rules. Connection tests send only a blank sample image and test text. The developer runs no collection server, sells no data, and uses no advertising or analytics trackers. The extension does not read unrelated browsing history, cookies, course passwords or payment information, and does not submit homework.

Users may cancel analysis, clear advice, delete model configuration/API keys, or uninstall the extension to remove local storage. Deleting local data does not delete data already received by a model provider. This extension adheres to the Chrome Web Store User Data Policy, including its Limited Use requirements. Contact: the project's GitHub Issues link above.
