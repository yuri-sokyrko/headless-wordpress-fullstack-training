// null, and NO render.php. This block is the second shape in Lesson 13.4 Key
// Concept 1: it contributes nothing to post_content but its comment, and no PHP
// runs for it at render time either. `the_content()` prints nothing for it.
//
// That is the right shape for a CTA in this architecture. The four attributes ARE
// the block, Lesson 14.4 renders them as a client island over the existing
// HobtCtaBand, and there is no markup for anyone to get wrong.
export default function save() {
  return null;
}
