# A-问题

## 痛点
ask、命令行授权请求这一类调用，用户不选就卡死整个循环。有些任务本来可以先做别的。

## 验收
任何调用都有编号；调用可以放到后台；有按编号的 wait 和 kill；用户回来能补答；循环不被无关调用阻塞。

## 适用性
只对能安全脱离当前步骤的调用有效。写文件不能后台，会破坏顺序语义。

## 先例
Reasonix：`bash_output(job_id?)` / `wait(job_ids?)` / `kill_shell(job_id)`，全部按 id。
DSH 已有 `ctx.jobs` + `job_output/job_list/job_kill`，缺 `wait` 与"任意工具后台"。
