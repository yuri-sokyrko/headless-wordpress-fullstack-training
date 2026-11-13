// The template hierarchy, as a plain object. Faust walks WordPress's own
// fallback order and picks the first key that exists — single-incident, then
// single, then index. Lesson 17.3 proves the fallback by deleting a key.
import archiveIncident from "./archive-incident";
import index from "./index-template";
import singleIncident from "./single-incident";

export default {
  "single-incident": singleIncident,
  "archive-incident": archiveIncident,
  archive: archiveIncident,
  index,
};
