import json
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
p = r'F:\cosmetic-compound-base\data\products\lotion.json'
raw = open(p, encoding='utf-8').read()
d = json.loads(raw)

required = ['id', 'title', 'lead', 'reading_minutes', 'key_facts', 'sections',
            'variants', 'ingredient_roles', 'references']
print('keys ok:', list(d.keys()) == required, '| extra/missing:',
      set(d.keys()) ^ set(required))
print('id/title:', d['id'], '/', d['title'])
print('lead:', len(d['lead']), 'ok' if 200 <= len(d['lead']) <= 400 else 'FAIL')
print('reading_minutes:', d['reading_minutes'])
print('key_facts:', len(d['key_facts']),
      'all<=120:', all(len(f) <= 120 for f in d['key_facts']))

expected_titles = ['Назначение и принцип работы', 'Основа рецептуры',
                   'Обязательные компоненты', 'Критерии качества',
                   'Ошибки в разработке', 'Регуляторные особенности']
print('titles match exactly:', [s['title'] for s in d['sections']] == expected_titles)

mins = dict(zip(expected_titles, [600, 600, 600, 500, 500, 300]))
mins['Обязательные компоненты'] = 600
for s in d['sections']:
    print(f"  {len(s['text']):5d} >= {mins[s['title']]} | {s['title']}")

print('variants:', len(d['variants']), 'min len:', min(len(v['text']) for v in d['variants']))
print('roles:', len(d['ingredient_roles']),
      'min role len:', min(len(r['role']) for r in d['ingredient_roles']),
      'all have examples:', all(r.get('examples') for r in d['ingredient_roles']))
print('refs:', len(d['references']),
      'all https:', all(r['url'].startswith('https://') for r in d['references']),
      'all titled:', all(r.get('title') for r in d['references']))

tot = len(d['lead']) + sum(len(s['text']) + len(s['title']) for s in d['sections'])
tot += sum(len(v['text']) + len(v['name']) for v in d['variants'])
tot += sum(len(r['role']) + len(r['examples']) + len(r['group']) for r in d['ingredient_roles'])
tot += sum(len(f) for f in d['key_facts'])
print('TOTAL CHARS:', tot)

names = {b for b in ['уникальн', 'лучш', 'революцион', 'инновационн', 'премиальн']}
low = raw.lower()
print('banned words present:', [b for b in names if b in low])
print('marketing-ish check done')
print('file bytes:', len(raw.encode('utf-8')))
