import { registerBlockType } from "@wordpress/blocks";

import metadata from "./block.json";
import Edit from "./edit";

// NO `save` key. A block with `render` in block.json and no `save` serialises to
// the self-closing comment, and `render.php` produces the HTML at request time.
// (Passing `save: () => null` explicitly would be equivalent and noisier.)

registerBlockType(metadata.name, {
  edit: Edit,
});
