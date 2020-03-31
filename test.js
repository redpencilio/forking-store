var rdflib=require("./rdflib.js");
rdflib=rdflib.default;
var store = rdflib.graph();
var me = store.sym('https://example.com/alice/card#me');