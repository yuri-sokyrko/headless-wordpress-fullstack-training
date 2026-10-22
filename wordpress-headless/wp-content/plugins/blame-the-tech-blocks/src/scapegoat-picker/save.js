// Returning null means: serialise the comment with its attributes, and emit NO
// markup. The stored form is the self-closing
//     <!-- wp:btt/scapegoat-picker {"termId":4} /-->
//
// This is NOT the same thing as a "dynamic block". Dynamic means PHP runs at
// render time, and this block has no render.php and no render_callback — so
// `the_content()` prints nothing for it at all. That is exactly right when a
// React front end owns the rendering: the block is a piece of structured data
// in the document, and Lesson 14.4 is what turns it into pixels.
//
// Lesson 13.4 builds btt/incident-ticker, which ALSO returns null and DOES have
// a render.php, and contrasts the two.
export default function save() {
  return null;
}
