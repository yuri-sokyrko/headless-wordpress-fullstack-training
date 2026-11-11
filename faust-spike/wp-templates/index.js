// The template hierarchy, as a plain object. Faust walks WordPress's own
// fallback order and picks the first key that exists — single-incident, then
// single, then index. Lesson 17.3 proves the fallback by deleting a key.
import index from "./index-template";
import SingleIncident from "./single-incident";

export default {
  "single-incident": SingleIncident,
  index,
};
