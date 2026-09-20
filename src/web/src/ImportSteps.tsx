import './import-steps.css'

export function ImportSteps({ current, machine = false }: { current: number; machine?: boolean }) {
  const steps = machine
    ? [['下载模板', '使用当前项目的机台模板'], ['填写资料', '一行一台，PM 填阶段表示安装'], ['检查并确认', '核对资料与基线识别结果']]
    : [['生成模板', '按当前项目组件生成 Excel'], ['填写版本', '每列一套版本，空白保持不变'], ['上传并录入', '新版本先进入测试中'], ['每日扫描（可选）', '首次导入后再配置固定文件']]
  return <ol className="import-steps" aria-label={machine ? '机台导入步骤' : '版本导入步骤'}>{steps.map(([title, text], index) => <li key={title} aria-current={index === current ? 'step' : undefined}><span className="import-step-number">{index + 1}</span><div><strong>{title}</strong><small>{text}</small></div></li>)}</ol>
}
