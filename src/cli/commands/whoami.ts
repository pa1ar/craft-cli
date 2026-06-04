import { parseWithGlobals, buildClient } from "../client-factory.ts";
import { bold, dim, jsonOutForArgs } from "../format.ts";

export async function runWhoami(argv: string[]) {
  const args = parseWithGlobals(argv);
  const { client, profile } = await buildClient(args);
  const info = await client.connection();

  if (args.flags.json) {
    console.log(jsonOutForArgs({ profile, authSource: profile === "env" ? "env" : "config", ...info }, args.flags));
    return;
  }
  console.log(`${bold("profile")}  ${profile}`);
  console.log(`${bold("auth")}     ${profile === "env" ? "env" : "config"}`);
  console.log(`${bold("space")}    ${info.space.name} ${dim(`(${info.space.id})`)}`);
  console.log(`${bold("time")}     ${info.space.friendlyDate} ${dim(info.space.timezone)}`);
  console.log(`${bold("url")}      ${client.url}`);
}
