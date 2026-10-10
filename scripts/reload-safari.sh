#!/bin/bash
# Automatically reload all active tabs in Safari

osascript << 'EOF'
tell application "System Events"
  set isRunning to (count of (processes whose name is "Safari")) > 0
end tell

if isRunning then
  tell application "Safari"
    repeat with w in windows
      try
        tell current tab of w to do JavaScript "location.reload()"
      end try
    end repeat
  end tell
  return "Safari tabs reloaded successfully"
else
  return "Safari not active"
end if
EOF
