import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v2.3.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.3.0/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.2/file.ts";
import { abortable } from "https://deno.land/std@0.171.0/async/mod.ts";
import {
  basename,
  isAbsolute,
  join,
  resolve,
} from "https://deno.land/std@0.177.0/path/mod.ts";

type Params = {
  src: string;
};

export class Source extends BaseSource<Params> {
  override kind = "file";

  override gather(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    return new ReadableStream<Item<ActionData>[]>({
      async start(controller) {
        const items: Item<ActionData>[] = [];
          const cwd = await fn.getcwd(args.denops);
          const abspath = join(cwd, args.sourceParams.src);
          let cmdarg: string = "-nHoE"
          if ((await Deno.stat(await Deno.realPath(abspath))).isDirectory) {
            cmdarg = "-nHRoE"
          }
          const proc = await Promise.resolve(Deno.run({ cmd: ["grep", cmdarg, "http(s?)://[0-9a-zA-Z?@=#+_&:/.%\-]+", abspath], stdout: "piped", stderr: "piped" }));
          for(const output of new TextDecoder().decode(await proc.output()).split(/\n/).slice(0, -1)){
              const file: string = output.split(/:/)[0]
              const lineNr: string = output.split(/:/)[1]
              const url: string = output.split(/:/).slice(2).join(':')
              // set action data
              const action: ActionData = {
                path: url,
                text: url,
                lineNr: lineNr,
              };
              items.push({ word: file + ":" + url, action: action });
          }
        controller.enqueue(items);
        controller.close();
      },
    });
  }

  override params(): Params {
    return {
        src: ".",
    };
  }
}
