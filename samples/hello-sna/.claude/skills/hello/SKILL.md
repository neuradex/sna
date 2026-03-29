---
description: Say hello to someone and demonstrate the SNA event pipeline
sna:
  args:
    name:
      type: string
      required: true
      description: Name of the person to greet
---

## Instructions

Greet the user by the provided name. Emit events to demonstrate the SNA pipeline.

### Steps

1. Emit a **start** event:
```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill hello --type start --message "Starting hello skill..."
```

2. Emit a **milestone** event after preparing the greeting:
```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill hello --type milestone --message "Greeting prepared for {{name}}"
```

3. Emit a **complete** event with the final greeting:
```bash
node node_modules/@sna-sdk/core/dist/scripts/emit.js \
  --skill hello --type complete \
  --message "Hello, {{name}}! Welcome to SNA." \
  --data '{"greeted": "{{name}}"}'
```
