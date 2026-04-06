#!/bin/bash
# experiment 1: sync timing - measure how quickly local stores update after API write

if [ -z "$CRAFT_SPACE_ID" ]; then echo "set CRAFT_SPACE_ID env var (e.g. from craft whoami --json)"; exit 1; fi
APP_SUPPORT="$HOME/Library/Containers/com.lukilabs.lukiapp/Data/Library/Application Support/com.lukilabs.lukiapp"
SQLITE_PATH="$APP_SUPPORT/Search/SearchIndex_${CRAFT_SPACE_ID}.sqlite"
PTS_DIR="$APP_SUPPORT/PlainTextSearch/${CRAFT_SPACE_ID}"
CRAFT="$(dirname "$0")/../../dist/craft"
MARKER="SYNC_TEST_$(date +%s)"

echo "=== Sync Timing Experiment ==="
echo "Marker: $MARKER"
echo ""

# record baseline
SQLITE_MTIME_BEFORE=$(stat -f "%m" "$SQLITE_PATH")
PTS_COUNT_BEFORE=$(ls "$PTS_DIR" | wc -l | tr -d ' ')
echo "Baseline:"
echo "  SQLite mtime: $SQLITE_MTIME_BEFORE ($(stat -f "%Sm" "$SQLITE_PATH"))"
echo "  PlainTextSearch file count: $PTS_COUNT_BEFORE"
echo ""

# write marker via API
echo "Writing marker via API..."
WRITE_START=$(python3 -c "import time; print(time.time())")
$CRAFT blocks append --date today --markdown "$MARKER" 2>&1
WRITE_END=$(python3 -c "import time; print(time.time())")
WRITE_MS=$(python3 -c "print(int(($WRITE_END - $WRITE_START) * 1000))")
echo "  API write took ${WRITE_MS}ms"
echo ""

# poll for changes
echo "Polling for local store updates (60 seconds max)..."
SQLITE_CHANGED=0
PTS_CHANGED=0
SQLITE_CHANGE_SEC=""
PTS_CHANGE_SEC=""
FTS_FOUND=0
FTS_FOUND_SEC=""

for i in $(seq 1 60); do
    SQLITE_MTIME_NOW=$(stat -f "%m" "$SQLITE_PATH")
    PTS_COUNT_NOW=$(ls "$PTS_DIR" | wc -l | tr -d ' ')

    if [ "$SQLITE_CHANGED" -eq 0 ] && [ "$SQLITE_MTIME_NOW" != "$SQLITE_MTIME_BEFORE" ]; then
        SQLITE_CHANGED=1
        SQLITE_CHANGE_SEC=$i
        echo "  [${i}s] SQLite mtime changed! (was $SQLITE_MTIME_BEFORE, now $SQLITE_MTIME_NOW)"
    fi

    if [ "$PTS_CHANGED" -eq 0 ] && [ "$PTS_COUNT_NOW" != "$PTS_COUNT_BEFORE" ]; then
        PTS_CHANGED=1
        PTS_CHANGE_SEC=$i
        echo "  [${i}s] PlainTextSearch file count changed! (was $PTS_COUNT_BEFORE, now $PTS_COUNT_NOW)"
    fi

    # check if marker appears in FTS
    if [ "$FTS_FOUND" -eq 0 ]; then
        FTS_RESULT=$(sqlite3 "file:$SQLITE_PATH?mode=ro" "SELECT id, substr(content, 1, 100) FROM BlockSearch WHERE BlockSearch MATCH '$MARKER'" 2>&1)
        if [ -n "$FTS_RESULT" ] && [[ ! "$FTS_RESULT" == *"database is locked"* ]]; then
            FTS_FOUND=1
            FTS_FOUND_SEC=$i
            echo "  [${i}s] Marker found in FTS5! Result: $FTS_RESULT"
        fi
    fi

    # check PTS JSON files for marker (check most recently modified)
    if [ "$PTS_CHANGED" -eq 0 ]; then
        NEWEST_PTS=$(ls -t "$PTS_DIR" | head -1)
        if [ -n "$NEWEST_PTS" ]; then
            if grep -q "$MARKER" "$PTS_DIR/$NEWEST_PTS" 2>/dev/null; then
                PTS_CHANGED=1
                PTS_CHANGE_SEC=$i
                echo "  [${i}s] Marker found in newest PlainTextSearch JSON ($NEWEST_PTS)!"
            fi
        fi
    fi

    # check if all detected
    if [ "$SQLITE_CHANGED" -eq 1 ] && [ "$PTS_CHANGED" -eq 1 ] && [ "$FTS_FOUND" -eq 1 ]; then
        echo "  All changes detected at ${i}s, stopping early."
        break
    fi

    sleep 1
done

echo ""
echo "=== Results ==="
echo "API write latency: ${WRITE_MS}ms"
if [ "$SQLITE_CHANGED" -eq 1 ]; then
    echo "SQLite mtime changed: ${SQLITE_CHANGE_SEC}s after write"
else
    echo "SQLite mtime: NO CHANGE within 60s"
fi
if [ "$FTS_FOUND" -eq 1 ]; then
    echo "FTS5 marker found: ${FTS_FOUND_SEC}s after write"
else
    echo "FTS5 marker: NOT FOUND within 60s"
fi
if [ "$PTS_CHANGED" -eq 1 ]; then
    echo "PlainTextSearch updated: ${PTS_CHANGE_SEC}s after write"
else
    echo "PlainTextSearch: NO CHANGE within 60s"
fi

# final check - is Craft app running?
echo ""
CRAFT_RUNNING=$(pgrep -x "Craft" 2>/dev/null)
if [ -n "$CRAFT_RUNNING" ]; then
    echo "Craft app: RUNNING (PID: $CRAFT_RUNNING)"
else
    echo "Craft app: NOT RUNNING (sync may require app to be open)"
fi
