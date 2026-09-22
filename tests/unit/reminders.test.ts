import { describe, expect, test } from "bun:test";
import { CraftClient } from "../../src/lib/client.ts";
import { runReminders } from "../../src/cli/commands/reminders.ts";

interface RecordedRequest {
  url: string;
  method: string;
  body?: unknown;
}

function testClient(response: unknown = { items: [] }) {
  const requests: RecordedRequest[] = [];
  const fetchMock = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return {
    client: new CraftClient({
      url: "https://connect.craft.do/links/test/api/v1",
      key: "pdk_test",
      fetch: fetchMock,
      retries: 0,
    }),
    requests,
  };
}

describe("reminders library", () => {
  test("lists with server-side status and pagination options", async () => {
    const { client, requests } = testClient({ items: [], pagination: { cursor: "next" } });
    const result = await client.reminders.list({ status: "all", limit: 25, cursor: "cursor-1" });

    expect(result.pagination?.cursor).toBe("next");
    expect(requests).toEqual([{
      method: "GET",
      url: "https://connect.craft.do/links/test/api/v1/reminders?status=all&limit=25&cursor=cursor-1",
      body: undefined,
    }]);
  });

  test("uses the documented create, update, and delete payload keys", async () => {
    const { client, requests } = testClient();
    await client.reminders.create([
      { blockId: "block-1", remindAt: "2030-01-15T10:00:00+01:00" },
      { blockId: "block-2" },
    ]);
    await client.reminders.update([
      { id: "reminder-1", remindAt: null },
      { id: "reminder-2", isCompleted: true },
    ]);
    await client.reminders.delete(["reminder-1", "reminder-2"]);

    expect(requests.map(({ method, body }) => ({ method, body }))).toEqual([
      {
        method: "POST",
        body: {
          reminders: [
            { blockId: "block-1", remindAt: "2030-01-15T10:00:00+01:00" },
            { blockId: "block-2" },
          ],
        },
      },
      {
        method: "PUT",
        body: {
          remindersToUpdate: [
            { id: "reminder-1", remindAt: null },
            { id: "reminder-2", isCompleted: true },
          ],
        },
      },
      {
        method: "DELETE",
        body: { idsToDelete: ["reminder-1", "reminder-2"] },
      },
    ]);
  });
});

describe("reminders command dry runs", () => {
  test("previews Save for later and scheduled reminder payloads without credentials", async () => {
    const saved = JSON.parse(await captureStdout(() => runReminders([
      "add", "block-1", "--dry-run", "--json",
    ])));
    expect(saved).toEqual({
      op: "reminders.create",
      reminders: [{ blockId: "block-1" }],
    });

    const scheduled = JSON.parse(await captureStdout(() => runReminders([
      "add", "block-1", "block-2", "--at", "2030-01-15T10:00:00+01:00", "--dry-run", "--json",
    ])));
    expect(scheduled.reminders).toEqual([
      { blockId: "block-1", remindAt: "2030-01-15T10:00:00+01:00" },
      { blockId: "block-2", remindAt: "2030-01-15T10:00:00+01:00" },
    ]);
  });

  test("previews reschedule, complete, reopen, and delete payloads", async () => {
    const cleared = JSON.parse(await captureStdout(() => runReminders([
      "reschedule", "reminder-1", "--at", "none", "--dry-run", "--json",
    ])));
    expect(cleared.remindersToUpdate).toEqual([{ id: "reminder-1", remindAt: null }]);

    const completed = JSON.parse(await captureStdout(() => runReminders([
      "complete", "reminder-1", "--dry-run", "--json",
    ])));
    expect(completed.remindersToUpdate).toEqual([{ id: "reminder-1", isCompleted: true }]);

    const reopened = JSON.parse(await captureStdout(() => runReminders([
      "reopen", "reminder-1", "--dry-run", "--json",
    ])));
    expect(reopened.remindersToUpdate).toEqual([{ id: "reminder-1", isCompleted: false }]);

    const deleted = JSON.parse(await captureStdout(() => runReminders([
      "rm", "reminder-1", "reminder-2", "--dry-run", "--json",
    ])));
    expect(deleted.idsToDelete).toEqual(["reminder-1", "reminder-2"]);
  });

  test("rejects timestamps without an explicit timezone", async () => {
    expect(runReminders([
      "add", "block-1", "--at", "2030-01-15T10:00:00", "--dry-run",
    ])).rejects.toThrow("UTC offset");
  });
});

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}
