---
description: Log out from MemoryStack and clear saved credentials
allowed-tools: ["Bash"]
---

# Logout from MemoryStack

Remove saved MemoryStack credentials to allow re-authentication.

## Steps

1. Use Bash to remove the credentials file:
   ```bash
   rm -f ~/.memorystack-claude/credentials.json
   ```

2. Confirm to the user:
   ```
   Successfully logged out from MemoryStack.

   Your credentials have been removed. The next time a MemoryStack hook runs,
   you'll be prompted to log in again via browser or set MEMORYSTACK_API_KEY.
   ```
