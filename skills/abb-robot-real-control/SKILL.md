---
name: abb-robot-real-control
description: >
  Real ABB controller operation skill. Use only for physical robot or RobotStudio
  controller control. Enforces explicit host targeting, status verification, and
  safety-confirmed motion.
---

# ABB Real Control Skill

Use tool `abb_robot_real` only.

## Execution Sequence (Strict)

1. Discover controllers
`abb_robot_real action:scan_controllers`

2. Connect to explicit host
`abb_robot_real action:connect host:<controller-ip> port:7000`

3. Verify state before motion
`abb_robot_real action:get_status`

4. Run low-speed validation move
`abb_robot_real action:movj joints:[0,-20,20,0,20,0] speed:10 zone:fine allowRealExecution:true`

## Core Operations

- System info: `get_system_info`
- Service info: `get_service_info`
- Read speed: `get_speed`
- Set speed: `set_speed speed:30`
- Read joints: `get_joints`
- World pose: `get_world_position`
- Event log: `get_event_log categoryId:0 limit:20`
- Analyze logs: `analyze_logs categoryId:0 limit:30`
- Backup module: `backup_module moduleName:<name> outputDir:<path>`
- Reset pointer: `reset_program_pointer taskName:T_ROB1`

## RAPID Operations

- Load: `load_rapid rapid_code:"..." module_name:MainModule allowRealExecution:true`
- Start: `start_program allowRealExecution:true`
- Stop: `stop_program`

## Safety Rules

- Require explicit real-host targeting for all connect operations.
- Require `allowRealExecution:true` for real execution and RAPID start.
- Use low speed first for validation.
- Report exact controller and task errors verbatim; do not mask them.
