import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { createZip } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLUGIN_DIR = "scansite-blackbox-collector";

/**
 * Collect the plugin's PHP files from disk.
 *
 * The manifest used to be hardcoded, which silently shipped a ZIP missing
 * `class-diagnostics.php` once that class was added. Discovering the files
 * means a new collector class is included automatically.
 */
async function collectPluginFiles(root) {
  const files = [];
  const missing = [];

  const read = async (rel) => {
    try {
      const data = await fs.readFile(path.join(root, rel), "utf8");
      files.push({ name: `${PLUGIN_DIR}/${rel}`, data });
    } catch {
      missing.push(rel);
    }
  };

  await read("scansite-blackbox-collector.php");

  try {
    const includes = (await fs.readdir(path.join(root, "includes")))
      .filter((name) => name.endsWith(".php"))
      .sort();
    for (const name of includes) await read(`includes/${name}`);
  } catch {
    missing.push("includes/");
  }

  return { files, missing };
}

/**
 * GET /api/blackbox/collector/download
 *
 * Builds the collector plugin ZIP from wordpress-plugin/ on disk, so the
 * dashboard's "Download Plugin" button serves the real source rather than a
 * placeholder file. Returns 404 if the source is not present.
 */
export async function GET() {
  const root = path.join(process.cwd(), "wordpress-plugin", PLUGIN_DIR);

  const { files, missing } = await collectPluginFiles(root);

  if (missing.length) {
    return NextResponse.json(
      {
        error: "Collector plugin source not found",
        missing,
        expectedAt: `wordpress-plugin/${PLUGIN_DIR}/`,
      },
      { status: 404 }
    );
  }

  const zip = createZip(files);

  return new NextResponse(zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${PLUGIN_DIR}.zip"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
