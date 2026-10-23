import { registerBlockType } from "@wordpress/blocks";

import metadata from "./block.json";
import Edit from "./edit";
import save from "./save";
import deprecated from "./deprecated";

// The stylesheet is imported here, not in edit.js. wp-scripts routes a file named
// `style.scss` to `style-index.css`, which block.json's `style` key then enqueues.
import "./style.scss";

// The FIRST argument is metadata.name. Passing the whole `metadata` object as the
// second argument means block.json stays the single description (Lesson 13.1 §7),
// and `edit`/`save` are the only two things JavaScript adds to it.
registerBlockType(metadata.name, { edit: Edit, save, deprecated });
