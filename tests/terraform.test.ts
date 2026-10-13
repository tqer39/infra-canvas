import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importTerraformJSON, importTerraformRepository } from '../src/terraform/index.js';
const repository = new URL('../examples/terraform', import.meta.url).pathname;
const fixture = async () => JSON.parse(await readFile(repository + '/fixture-plan.json', 'utf8'));
test('plan instances, source mapping, route evidence and SG associations preserve meaning', async () => {
  const d = await importTerraformRepository({repository,json:'fixture-plan.json'});
  const byAddress = (address:string) => d.resources.find(r=>r.provenance?.address===address)!;
  assert.equal(byAddress('aws_instance.worker[0]').provenance?.kind,'plan');
  assert.equal(byAddress('aws_instance.worker[0]').provenance?.file,'main.tf');
  assert.equal(byAddress('module.network.aws_subnet.public["a"]').attributes.subnetVisibility,'public');
  assert.equal(byAddress('module.network.aws_subnet.public["c"]').attributes.subnetVisibility,'unknown');
  assert.equal(byAddress('aws_instance.worker[0]').attributes.placement,'actual');
  assert.equal(byAddress('aws_lb.web').attributes.placement,'configuration');
  assert.equal((byAddress('aws_security_group.app').attributes.members as string[]).length,3);
  assert.equal(d.resources.filter(r=>r.type==='account').length,0);
  assert.ok(byAddress('aws_instance.worker[0]').unresolved?.some(v=>v.includes('availability_zone')));
  assert.ok(d.connections.some(e=>e.kind==='dependency'));
  assert.ok(d.connections.every(e=>e.kind!=='traffic'));
  assert.ok(d.resources.every(r=>/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(r.id)));
});
test('state distinct from plan and unsupported format rejects safely',async()=>{
  const d = await importTerraformRepository({repository,json:'fixture-state.json'});
  assert.ok(d.resources.every(r=>r.provenance?.kind==='state'));
  assert.throws(()=>importTerraformJSON({format_version:'2.0',values:{}}),/format_version/);
  assert.throws(()=>importTerraformJSON({version:4,resources:[]}),/format_version/);
});
test('arbitrary attributes, tags and sensitive nested permitted attributes never leak',async()=>{
  const input = await fixture(); const r = input.planned_values.root_module.resources[1];
  Object.assign(r.values,{password:'SENTINEL',description:'SENTINEL',tags:{Name:'SENTINEL'},user_data:'SENTINEL',availability_zone:'ap-northeast-1a',subnet_id:'SENTINEL'});
  r.sensitive_values={availability_zone:true,subnet_id:true};
  input.resource_changes[0].change.after_sensitive={instance_type:true};
  const d=importTerraformJSON(input);
  assert.ok(!JSON.stringify(d).includes('SENTINEL'));
  assert.equal(d.resources.find(resource=>resource.provenance?.address===r.address)?.attributes.instance_type,undefined);
  assert.equal(d.resources.find(resource=>resource.provenance?.address===r.address)?.attributes.availability_zone,undefined);
});
test('static local modules match files; repeats remain unresolved and literals safe',async()=>{
  const d=await importTerraformRepository({repository});
  const worker=d.resources.find(r=>r.provenance?.address==='aws_instance.worker')!;
  assert.equal(worker.provenance?.kind,'static');
  assert.equal(worker.attributes.instance_type,'t3.micro');
  assert.ok(worker.unresolved?.some(v=>v.includes('count / for_each')));
  assert.equal(d.resources.find(r=>r.provenance?.address==='module.network.aws_vpc.main')?.provenance?.file,'modules/network/main.tf');
});
test('whole resource sensitive masks and nested network masks suppress every value',async()=>{
  for(const mask of ['sensitive_values','after_sensitive']) {
    const input=await fixture(); const resource=input.planned_values.root_module.resources[1];
    if(mask==='sensitive_values') resource.sensitive_values=true;
    else input.resource_changes[0].change.after_sensitive=true;
    const d=importTerraformJSON(input); const worker=d.resources.find(r=>r.provenance?.address===resource.address)!;
    assert.equal(worker.attributes.instance_type,undefined);
    assert.equal(worker.attributes.subnets,undefined);
  }
  const input=await fixture(); input.planned_values.root_module.resources.push({address:'aws_ecs_service.api',type:'aws_ecs_service',values:{network_configuration:[{subnets:['subnet-private'],security_groups:['sg-demo']}]},sensitive_values:{network_configuration:[{subnets:true}]}});
  const d=importTerraformJSON(input); const service=d.resources.find(r=>r.provenance?.address==='aws_ecs_service.api')!;
  assert.equal(service.attributes.subnets,undefined);
  assert.ok(!d.connections.some(e=>e.source===service.id));
});
test('after_sensitive false cannot clear sensitive_values true',async()=>{
  const input=await fixture(); const r=input.planned_values.root_module.resources[1];
  r.sensitive_values={instance_type:true}; input.resource_changes[0].change.after_sensitive={instance_type:false};
  const d=importTerraformJSON(input); assert.equal(d.resources.find(resource=>resource.provenance?.address===r.address)?.attributes.instance_type,undefined);
});
test('Terraform DSL roundtrip retains kind, addresses, source and relationships',async()=>{
  const {serializeDSL}=await import('../src/core/serialize.js');
  const {parseDSL}=await import('../src/core/parser.js');
  const original=await importTerraformRepository({repository,json:'fixture-plan.json'});
  const result=parseDSL(serializeDSL(original));
  assert.deepEqual(result.diagnostics.filter(d=>d.severity==='error'),[]);
  const provenance = (resources:typeof original.resources) => Object.fromEntries(resources.map(r=>[r.id, JSON.parse(JSON.stringify(r.provenance))]));
  assert.deepEqual(provenance(result.diagram!.resources),provenance(original.resources));
  assert.equal(result.diagram?.connections.length,original.connections.length);
});

test('RDS subnet-group is configuration and does not imply actual subnet placement',async()=>{
  const input=await fixture(); input.planned_values.root_module.resources.push(
    {address:'aws_db_subnet_group.db',type:'aws_db_subnet_group',values:{name:'db-group',subnet_ids:['subnet-private','subnet-public-c']}},
    {address:'aws_db_instance.db',type:'aws_db_instance',values:{db_subnet_group_name:'db-group',engine:'postgres',vpc_security_group_ids:['sg-demo'],password:'SENTINEL'}}
  );
  const d=importTerraformJSON(input); const db=d.resources.find(r=>r.provenance?.address==='aws_db_instance.db')!;
  assert.equal(db.attributes.placement,'configuration');
  assert.equal((db.attributes.subnets as string[]).length,2);
  assert.equal(db.parentId,undefined);
  assert.ok(!JSON.stringify(d).includes('SENTINEL'));
});
test('same-name RDS subnet groups across aliases remain unresolved',async()=>{
  const input=await fixture(); input.planned_values.root_module.resources.push(
    {address:'aws_db_subnet_group.east',type:'aws_db_subnet_group',values:{name:'duplicate-group',subnet_ids:['subnet-private']}},
    {address:'aws_db_subnet_group.west',type:'aws_db_subnet_group',values:{name:'duplicate-group',subnet_ids:['subnet-public-c']}},
    {address:'aws_db_instance.west',type:'aws_db_instance',values:{db_subnet_group_name:'duplicate-group'}}
  );
  input.configuration.root_module.resources.push(
    {address:'aws_db_subnet_group.east',provider_config_key:'aws.east'},
    {address:'aws_db_subnet_group.west',provider_config_key:'aws.west'},
    {address:'aws_db_instance.west',provider_config_key:'aws.west'}
  );
  const d=importTerraformJSON(input); const db=d.resources.find(r=>r.provenance?.address==='aws_db_instance.west')!;
  assert.equal(db.attributes.subnets,undefined);
  assert.ok(db.unresolved?.some(message=>message.includes('候補が複数')));
  assert.ok(!d.connections.some(edge=>edge.source===db.id));
});
test('absent and partially absent topology targets remain explicitly unresolved without leaking values',async()=>{
  const input=await fixture(); input.planned_values.root_module.resources.push(
    {address:'aws_instance.orphan',type:'aws_instance',values:{subnet_id:'SUBNET_SENTINEL',vpc_security_group_ids:['sg-demo','SG_SENTINEL']}},
    {address:'aws_subnet.orphan',type:'aws_subnet',values:{vpc_id:'VPC_SENTINEL'}},
    {address:'aws_ecs_service.orphan',type:'aws_ecs_service',values:{network_configuration:[{subnets:['subnet-private','SUBNET_SENTINEL'],security_groups:['SG_SENTINEL']}]}}
  );
  const d=importTerraformJSON(input); const orphan=d.resources.find(r=>r.provenance?.address==='aws_instance.orphan')!;
  assert.ok(orphan.unresolved?.includes('Subnet の関連先は未解決'));
  assert.ok(orphan.unresolved?.includes('Security Group の関連先は未解決'));
  assert.ok(d.resources.find(r=>r.provenance?.address==='aws_subnet.orphan')?.unresolved?.includes('VPC の関連先は未解決'));
  const ecs=d.resources.find(r=>r.provenance?.address==='aws_ecs_service.orphan')!;
  assert.ok(ecs.unresolved?.includes('Subnet の関連先は未解決'));
  assert.ok(ecs.unresolved?.includes('Security Group の関連先は未解決'));
  assert.equal((ecs.attributes.subnets as string[]).length,1);
  assert.ok(!JSON.stringify(d).includes('SENTINEL'));
});
test('static indexed repeated subnet reference cannot classify all declared instances public',async()=>{
  const d=await importTerraformRepository({repository});
  const subnet=d.resources.find(r=>r.provenance?.address==='module.network.aws_subnet.public')!;
  assert.equal(subnet.attributes.subnetVisibility,'unknown');
  assert.ok(subnet.unresolved?.some(message=>message.includes('for_each')));
  const association=d.resources.find(r=>r.provenance?.address==='module.network.aws_route_table_association.public')!;
  assert.ok(association.unresolved?.some(message=>message.includes('未確定')));
});

test('Git loose, packed and common refs accept only commit hashes and never disclose arbitrary contents',async()=>{
  for(const kind of ['detached','loose','packed','common']) {
    const temporary=await mkdtemp(path.join(tmpdir(),'infra-canvas-commit-'));
    try {
      await writeFile(path.join(temporary,'main.tf'),'resource "aws_vpc" "main" {}\n');
      await mkdir(path.join(temporary,'.git','refs','heads'),{recursive:true});
      await writeFile(path.join(temporary,'.git','HEAD'),kind==='detached'?'SECRET_SENTINEL':'ref: refs/heads/main');
      if(kind==='loose') await writeFile(path.join(temporary,'.git','refs','heads','main'),'SECRET_SENTINEL');
      if(kind==='packed') await writeFile(path.join(temporary,'.git','packed-refs'),'SECRET_SENTINEL refs/heads/main\n');
      if(kind==='common') {
        await mkdir(path.join(temporary,'common','refs','heads'),{recursive:true});
        await writeFile(path.join(temporary,'.git','commondir'),'../common');
        await writeFile(path.join(temporary,'common','refs','heads','main'),'SECRET_SENTINEL');
      }
      const diagram=await importTerraformRepository({repository:temporary});
      assert.equal(diagram.resources[0]?.provenance?.commit,undefined);
      assert.ok(!JSON.stringify(diagram).includes('SECRET_SENTINEL'));
    } finally { await rm(temporary,{recursive:true,force:true}); }
  }
});
test('Git ref traversal is rejected even when target contents look like a commit hash',async()=>{
  const temporary=await mkdtemp(path.join(tmpdir(),'infra-canvas-traversal-'));
  const hash='a'.repeat(40);
  try {
    await writeFile(path.join(temporary,'main.tf'),'resource "aws_vpc" "main" {}\n');
    await mkdir(path.join(temporary,'.git','refs'),{recursive:true});
    await writeFile(path.join(temporary,'outside'),hash);
    for(const ref of ['../outside','refs/../../outside']) {
      await writeFile(path.join(temporary,'.git','HEAD'),'ref: '+ref);
      assert.equal((await importTerraformRepository({repository:temporary})).resources[0]?.provenance?.commit,undefined);
    }
    await writeFile(path.join(temporary,'.git','HEAD'),hash);
    assert.equal((await importTerraformRepository({repository:temporary})).resources[0]?.provenance?.commit,hash);
    await mkdir(path.join(temporary,'.git','refs','heads'));
    await writeFile(path.join(temporary,'.git','HEAD'),'ref: refs/heads/main');
    await writeFile(path.join(temporary,'.git','refs','heads','main'),hash);
    assert.equal((await importTerraformRepository({repository:temporary})).resources[0]?.provenance?.commit,hash);
  } finally { await rm(temporary,{recursive:true,force:true}); }
});
