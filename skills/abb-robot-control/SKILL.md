---
name: abb-robot-control
description: >
  Unified ABB robot control skill for OpenClaw. Use for virtual viewer motion,
  ABB RobotStudio virtual controller testing, and real ABB controller operations.
  Enforces explicit mode selection and safety confirmation before physical motion.
metadata:
  openclaw:
    emoji: "🤖"
    requires:
      bins: []
---

# ABB Robot Control Skill

This skill is the execution contract for the `abb_robot` MCP tool.

## Operating Rules

- For physical robots, always use `mode:real` explicitly.
- For 3D viewer simulation, always use `mode:virtual` explicitly.
- Do not rely on `mode:auto` for safety-critical tasks.
- Before any physical motion command, include `safety_confirmed:true`.
- Never execute `execute_rapid` on real hardware unless user explicitly asks and confirms risk.

## Minimum Safe Command Patterns

### Real Robot

1. Connect
`abb_robot action:connect mode:real host:<controller-ip> port:7000`

2. Check status
`abb_robot action:get_status mode:real`

3. Controlled move
`abb_robot action:movj mode:real safety_confirmed:true joints:[0,-20,20,0,20,0] speed:10`

### Virtual Viewer

1. Connect bridge session
`abb_robot action:connect mode:virtual host:127.0.0.1 port:9877`

2. Motion
`abb_robot action:movj mode:virtual joints:[30,-20,55,15,25,10] speed:40`

## Troubleshooting Decision Tree

1. If user says "real robot did not move":
Check whether mode was `real` and not virtual fallback.

2. If connect failed in real mode:
Report exact NetScan/discovery error and discovered controllers.

3. If motion blocked in real mode:
Check missing `safety_confirmed:true` first.

4. If virtual movement not visible:
Check ws-bridge connection and viewer model loading.

## Action Reference (Common)

- Connect: `connect`
- Disconnect: `disconnect`
- Status: `get_status`
- Current joints: `get_joints`
- Set joints: `set_joints`
- MoveJ: `movj`
- Home: `go_home`
- RAPID execute: `execute_rapid`
- Motors: `motors_on`, `motors_off`
- List robot profiles: `list_robots`
- Version: `get_version`
