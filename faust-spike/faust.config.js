// Faust's functions.php. It registers the template map and any Faust plugins.
// The WordPress URL does NOT live here — Faust reads it from the environment,
// because the BROWSER needs it too. See Key Concept 7.
import { setConfig } from "@faustwp/core";

import templates from "./wp-templates";

export default setConfig({ templates });
