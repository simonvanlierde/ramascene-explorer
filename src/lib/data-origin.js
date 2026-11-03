// Where the large data lives in a deployed build: the Parquet and the browser store are
// read from this origin (a bucket on its own hostname) by their content hashes. Unset, as
// in development and the tests, they are read next to the page. Set at build time with
// VITE_DATA_ORIGIN, e.g. https://data.example.org/ (docs/publishing.md#data-host).
// import.meta.env is undefined under node --test, hence the ?.
const origin = import.meta.env?.VITE_DATA_ORIGIN;
// with a trailing slash, so a path in it is kept when keys resolve against it
export const DATA_ORIGIN = origin ? origin.replace(/\/?$/, "/") : null;
