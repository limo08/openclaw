---
name: abb-robot-virtual-control
description: >
  Virtual ABB viewer operation skill. Use only for 3D kinematic viewer and
  ws-bridge simulation workflows. No physical robot operations.
---

# ABB Virtual Control Skill

Use tool `abb_robot_virtual` only.

## Required Environment

- ws-bridge running on `127.0.0.1:9877`
- `robot_kinematic_viewer.html` opened and connected
- Robot model loaded in viewer

## Standard Flow

1. Connect
`abb_robot_virtual action:connect host:127.0.0.1 port:9877 robot_id:abb-crb-15000`

2. Check
`abb_robot_virtual action:get_status`

3. Motion
`abb_robot_virtual action:movj joints:[10,-10,20,0,10,0] speed:40`

4. Return home
`abb_robot_virtual action:go_home`

5. Disconnect
`abb_robot_virtual action:disconnect`

## Notes

- This skill is simulation-only.
- If movement is not visible, verify bridge connection and model loading first.
