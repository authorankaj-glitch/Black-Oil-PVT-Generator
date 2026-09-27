/*
 * Black-Oil PVT Generator
 * Copyright (c) 2026 Ankaj Kumar Sinha. MIT licence (see LICENSE).
 *
 * project.js -- save a whole working session to a file and read it back.
 *
 * The page already keeps its state in the browser between visits; a
 * project file lets the user stop midway, move to another computer, keep
 * versions of a study, or hand the work to a colleague. It holds everything
 * the page is working on, in field units:
 *
 *   {
 *     kind: 'pvt-project', version: 1, app, copyright, savedAt, name,
 *     fluid:    'oil' | 'gas'        the fluid system on screen
 *     units:    'field' | 'metric'   the display units
 *     labMode:  'none' | 'one' | 'several'
 *     inputs:   { oil: { inputs, preset }, gas: { inputs, preset } }
 *               the case inputs of each fluid (as the page reads them)
 *     lab:      { oil, gas }         the one-report laboratory tables
 *     samples:  { list, fieldTune }  the PVT samples and the field-wide switch
 *   }
 *
 * Reading a file checks its kind and version and fills anything missing
 * with the page defaults, so an older or hand-edited file still opens.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PVTProject = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KIND = 'pvt-project';
  var VERSION = 1;
  var APP = 'Black-Oil PVT Generator';
  var COPYRIGHT = 'Copyright (c) 2026 Ankaj Kumar Sinha - MIT licence';

  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function pick(v, allowed, dflt) { return allowed.indexOf(v) >= 0 ? v : dflt; }

  /* Case inputs travel without their laboratory data: that lives in lab. */
  function cleanInputs(o) {
    if (!isObj(o)) return null;
    var c = JSON.parse(JSON.stringify(o));
    delete c.lab; delete c.tune; delete c.tuning; delete c.labMode;
    return c;
  }

  /* Assemble a project from the page state. */
  function pack(state) {
    state = state || {};
    var inputs = {};
    ['oil', 'gas'].forEach(function (f) {
      var s = (state.inputs || {})[f];
      inputs[f] = s && s.inputs ? { inputs: cleanInputs(s.inputs), preset: s.preset || '' } : null;
    });
    return {
      kind: KIND, version: VERSION, app: APP, copyright: COPYRIGHT,
      savedAt: (state.now || new Date()).toISOString(),
      name: String(state.name || '').slice(0, 120),
      fluid: pick(state.fluid, ['oil', 'gas'], 'oil'),
      units: pick(state.units, ['field', 'metric'], 'field'),
      labMode: pick(state.labMode, ['none', 'one', 'several'], 'none'),
      inputs: inputs,
      lab: state.lab || null,
      samples: state.samples || { list: [], fieldTune: false }
    };
  }

  /* Read a project file. Throws an Error that says what is wrong. */
  function unpack(text) {
    var o;
    try { o = typeof text === 'string' ? JSON.parse(text) : text; }
    catch (e) { throw new Error('This file is not a project file - it is not valid JSON.'); }
    if (!isObj(o) || o.kind !== KIND) {
      throw new Error('This file is not a PVT Generator project. Open a file saved with "Save project".');
    }
    if (!(o.version >= 1) || o.version > VERSION) {
      throw new Error('This project was saved by a newer version of the page (format ' + o.version +
        '). Open it with the current version on GitHub Pages.');
    }
    var inputs = {};
    ['oil', 'gas'].forEach(function (f) {
      var s = isObj(o.inputs) ? o.inputs[f] : null;
      inputs[f] = s && isObj(s.inputs) ? { inputs: cleanInputs(s.inputs), preset: String(s.preset || '') } : null;
    });
    var fluid = pick(o.fluid, ['oil', 'gas'], 'oil');
    if (!inputs[fluid]) throw new Error('The project has no case inputs for the ' + fluid + ' reservoir.');
    inputs[fluid].inputs.fluid = fluid;
    var lab = isObj(o.lab) ? o.lab : null;
    var samples = isObj(o.samples) && Array.isArray(o.samples.list)
      ? { list: o.samples.list.filter(isObj), fieldTune: !!o.samples.fieldTune } : { list: [], fieldTune: false };
    return {
      name: String(o.name || ''), savedAt: o.savedAt || null, fluid: fluid,
      units: pick(o.units, ['field', 'metric'], 'field'),
      labMode: pick(o.labMode, ['none', 'one', 'several'], 'none'),
      inputs: inputs, lab: lab, samples: samples
    };
  }

  /* A file name from the project name and the save time. */
  function filename(name, now) {
    var d = (now || new Date()).toISOString().slice(0, 16).replace('T', '_').replace(':', '');
    var stem = String(name || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return (stem ? stem + '_' : 'pvt-project_') + d + '.json';
  }

  return { pack: pack, unpack: unpack, filename: filename, KIND: KIND, VERSION: VERSION };
});
