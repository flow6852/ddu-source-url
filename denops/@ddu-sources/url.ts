import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v2.3.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.3.0/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.2/file.ts";
import { join, resolve } from "https://deno.land/std@0.177.0/path/mod.ts";
import { abortable } from "https://deno.land/std@0.171.0/async/mod.ts";

type Params = {
  src: string;
  chunkSize: number;
  ignoredDirectories: Array<string>;
  expandSymbolicLink: boolean;
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
        // initialize
        let items: Item<ActionData>[] = [];
        const abortController = new AbortController();

        // select src
        const regexpStr = "http(s?)://[0-9a-zA-Z?@=#+_&:/.%-]+";
        if ((new RegExp(regexpStr)).test(args.sourceParams.src)) {
          const response = await fetch(args.sourceParams.src);
          if (!response.ok) {
            console.error(
              "response error: " + args.sourceParams.src + ": " +
                response.statusText,
            );
            return;
          }
          const urls = getUrls(
            await response.text(),
            new RegExp(regexpStr, "g"),
          );
          for (const url of urls) {
            items.push({
              word: url,
              action: {
                path: url,
                text: url,
              },
            });
          }
        } else if (
          (await Deno.stat(
            await Deno.realPath(
              (await fn.getcwd(args.denops)) + "/" + args.sourceParams.src,
            ),
          )).isFile
        ) {
          console.log("file");
          const raw = await Deno.readTextFile(
            await Deno.realPath(
              (await fn.getcwd(args.denops)) + "/" + args.sourceParams.src,
            ),
          );
          const urls = getUrls(raw, new RegExp(regexpStr, "g"));
          for (const url of urls) {
            items.push({
              word: url,
              action: {
                path: url,
                text: url,
              },
            });
          }
        } else {
          const it = walkLocal(
            resolve(args.sourceParams.src, args.sourceParams.src),
            args.sourceParams.ignoredDirectories,
            abortController.signal,
            args.sourceParams.chunkSize,
            args.sourceParams.expandSymbolicLink,
            new RegExp(regexpStr, "g"),
          );
          let enqueueSize: number = args.sourceParams.chunkSize;
          try {
            for await (const chunk of it) {
              items = items.concat(chunk);
              if (items.length >= enqueueSize) {
                enqueueSize = 10 * args.sourceParams.chunkSize;
                controller.enqueue(items);
                items = [];
              }
            }
            if (items.length) {
              controller.enqueue(items);
            }
          } catch (e: unknown) {
            if (e instanceof DOMException) {
              return;
            }
            console.error(e);
          }
        }
        controller.enqueue(items);
        controller.close();
      },
    });
  }

  override params(): Params {
    return {
      src: ".",
      chunkSize: 1000,
      ignoredDirectories: [],
      expandSymbolicLink: false,
    };
  }
}

// File or Directory
async function* walkLocal(
  root: string,
  ignoredDirectories: string[],
  signal: AbortSignal,
  chunkSize: number,
  expandSymbolicLink: boolean,
  regexp: RegExp,
): AsyncGenerator<Item<ActionData>[]> {
  const walkLocal = async function* (
    dir: string,
  ): AsyncGenerator<Item<ActionData>[]> {
    let chunk: Item<ActionData>[] = [];
    try {
      for await (const entry of abortable(Deno.readDir(dir), signal)) {
        const abspath = join(dir, entry.name);
        if (
          (await Deno.stat(await Deno.realPath(abspath))).isFile ||
          (!expandSymbolicLink && !entry.isDirectory)
        ) {
          const raw = await Deno.readTextFile(abspath);
          const urls = getUrls(raw, regexp);
          for (const url of urls) {
            const n = chunk.push({
              word: url,
              action: {
                path: url,
                text: url,
              },
            });
            if (n >= chunkSize) {
              yield chunk;
              chunk = [];
            }
          }
        } else if (ignoredDirectories.includes(entry.name)) {
          continue;
        } else if (
          entry.isSymlink &&
          (await Deno.stat(await Deno.realPath(abspath))).isDirectory &&
          abspath.includes(await Deno.realPath(abspath))
        ) {
          continue;
        } else {
          yield* walkLocal(abspath);
        }
      }
      if (chunk.length) {
        yield chunk;
      }
    } catch (e: unknown) {
      if (e instanceof Deno.errors.PermissionDenied) {
        // Ignore this error
        // See https://github.com/Shougo/ddu-source-file_rec/issues/2
        return;
      }
      throw e;
    }
  };
  yield* walkLocal(root);
}

function getUrls(src: string, regexp: RegExp) {
  const match = src.match(regexp);
  if (match) {
    return match;
  } else {
    return [];
  }
}
