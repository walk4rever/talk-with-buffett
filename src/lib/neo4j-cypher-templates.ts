export const CYPHER_TEMPLATES = {
  moat: `
MATCH (c:Concept {id: "moat"})
OPTIONAL MATCH (p:Person)-[r:EXPLAINS|MENTIONS]->(c)
OPTIONAL MATCH (para:Paragraph {id: r.paragraph_id})
OPTIONAL MATCH (para)<-[:CONTAINS]-(l:Letter)
RETURN
  c.name AS concept,
  c.zh AS conceptZh,
  p.name AS speaker,
  type(r) AS relation,
  l.year AS year,
  para.id AS paragraphId,
  para.text AS quote
ORDER BY year DESC
LIMIT 10;
  `,
  insuranceFloat: `
MATCH (c:Concept {id: "insurance_float"})
OPTIONAL MATCH (co:Company)-[r:GENERATES|USES|RELIES_ON]->(c)
OPTIONAL MATCH (para:Paragraph {id: r.paragraph_id})
OPTIONAL MATCH (para)<-[:CONTAINS]-(l:Letter)
RETURN
  c.name AS concept,
  c.zh AS conceptZh,
  co.name AS company,
  type(r) AS relation,
  l.year AS year,
  para.id AS paragraphId,
  para.text AS quote
ORDER BY year DESC
LIMIT 10;
  `,
};
