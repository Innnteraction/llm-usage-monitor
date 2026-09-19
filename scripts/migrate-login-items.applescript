-- Only old login items with this app's known name and executable are eligible.
on run argv
    set operation to item 1 of argv
    tell application "System Events"
        if operation is "restore" then
            set itemName to item 2 of argv
            set itemPath to item 3 of argv
            set itemHidden to (item 4 of argv is "true")
            if not (exists login item itemName) then
                make login item at end with properties {name:itemName, path:itemPath, hidden:itemHidden}
            end if
            return ""
        end if
        set resultText to ""
        repeat with entry in (get login items)
            set itemName to name of entry
            set itemPath to path of entry
            if (itemName is "LLM Usage Monitor" or itemName is "LLM Usage Monitor Native") and (itemPath ends with "/LLM Usage Monitor.app" or itemPath ends with "/LLM Usage Monitor Native.app" or itemPath ends with "/llm-usage-monitor") then
                if operation is "query" then
                    set resultText to resultText & itemName & tab & itemPath & tab & ((hidden of entry) as text) & linefeed
                else if operation is "remove" then
                    delete entry
                else
                    error "Unknown migration operation"
                end if
            end if
        end repeat
        return resultText
    end tell
end run
