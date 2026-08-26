const img = name => `/assets/menu/${name}.jpg`

export const fallbackCategories = [
  'Favoritos','Entradas','Kushiagues','Sopas','Ramen','Poke Bowl','Rollos','Arroz','Postres'
]

export const fallbackProducts = [
  {slug:'edamames',name:'Edamames',category:'Entradas',price:98,desc:'150 g · Al vapor, asados con mantequilla y soya o spicy lemon.',image:img('edamames'),featured:true},
  {slug:'spring-rolls',name:'4 Spring Rolls',category:'Entradas',price:92,desc:'4 piezas · Rellenos de vegetales, acompañados de salsa agridulce.',image:img('spring-rolls'),featured:true},
  {slug:'gyozas',name:'Gyozas de cerdo',category:'Entradas',price:104,desc:'5 piezas · Empanadillas fritas de cerdo con vegetales, acompañadas de salsa spicy ponzu.',image:img('gyozas')},
  {slug:'rokka',name:'Camarones Rokka',category:'Entradas',price:168,desc:'Camarón tempura, mayo chipotle, cebollín y aguacate sobre cama de ensalada.',image:img('rokka'),featured:true,spicy:true},
  {slug:'karaague',name:'Chicken Karaague',category:'Entradas',price:112,desc:'Pechuga marinada en soya, ajo y jengibre, con mayo chipotle y limón.',image:img('karaague')},
  {slug:'tempura-verduras',name:'Tempura de verduras',category:'Entradas',price:116,desc:'4 piezas · Verduras de temporada tempurizadas.',image:img('tempura-verduras')},
  {slug:'kushi-queso',name:'Kushiague de queso manchego',category:'Kushiagues',price:106,desc:'2 piezas · Brochetas empanizadas acompañadas de salsa kushiague.',image:img('kushi-queso')},
  {slug:'misoshiro',name:'Misoshiro',category:'Sopas',price:78,desc:'225 ml · Fondo miso, harusame, wakame, cebollín y tofu.',image:img('misoshiro')},
  {slug:'pork-belly-ramen',name:'Pork Belly Ramen',category:'Ramen',price:206,desc:'Pasta ramen, pork belly teriyaki, naruto, verduras, huevo, nori y fondo tonkotsu.',image:img('pork-belly-ramen'),featured:true},
  {slug:'tantan-ramen',name:'Tantan Ramen',category:'Ramen',price:218,desc:'Pasta ramen, carne de cerdo picante, chile tempura, huevo, espinaca y fondo tonkotsu.',image:img('tantan-ramen'),spicy:true},
  {slug:'ebi-crispy-ramen',name:'Ebi Crispy Ramen',category:'Ramen',price:236,desc:'Pasta ramen, camarones crujientes, cebollín, huevo, jitomate, chilli oil y tonkotsu.',image:img('ebi-crispy-ramen'),featured:true,spicy:true},
  {slug:'sunset',name:'Sunset',category:'Poke Bowl',price:196,desc:'320 g · Salmón, atún, pescado blanco, aguacate, cebollín y mayo sriracha.',image:img('sunset')},
  {slug:'tokio-bacon',name:'Tokio Bacon',category:'Poke Bowl',price:186,desc:'320 g · Salmón, tocino ahumado, aguacate, queso fila, pepino y mayo habanero.',image:img('tokio-bacon')},
  {slug:'samurai',name:'Samurai',category:'Poke Bowl',price:182,desc:'320 g · Camarones rokka, mango, col morada, aguacate y mayo chipotle.',image:img('samurai')},
  {slug:'spicy-tuna-roll',name:'Spicy Tuna Roll',category:'Rollos',price:154,desc:'10 piezas · Tempurizado, nori, salsa de anguila, cebollín, aguacate y atún spicy.',image:img('spicy-tuna-roll'),featured:true,spicy:true},
  {slug:'tampico-roll',name:'Tampico Roll',category:'Rollos',price:148,desc:'10 piezas · Empanizado, tampico, salsa kushiague, aguacate y pepino.',image:img('tampico-roll')},
  {slug:'philly-roll',name:'Philly Roll',category:'Rollos',price:162,desc:'10 piezas · Empanizado, salsa de anguila, salmón, pepino y queso.',image:img('philly-roll')},
  {slug:'crunch-roll',name:'Crunch Roll',category:'Rollos',price:172,desc:'10 piezas · Salmón, mayo chipotle, kakiage, queso crema y aguacate.',image:img('crunch-roll')},
  {slug:'gohan-kyo',name:'Gohan Kyo',category:'Arroz',price:108,desc:'320 g · Gohan, tampico, aguacate, mango, kanikama tempura, chipotle y anguila.',image:img('gohan-kyo')},
  {slug:'cheesecake-japones',name:'Cheese Cake Japonés',category:'Postres',price:126,desc:'Individual · Con helado de vainilla y salsa de frutos rojos.',image:img('cheesecake-japones')}
]

export const branches = [
  {id:'zakia',name:'KYO Zákia',short:'Zákia',address:'Plaza UNITY, local 103 PB, Zákia.',phone:'442 890 3797',eta:'35–50 min'},
  {id:'milenio',name:'KYO Milenio',short:'Milenio',address:'Plaza UBIKA Milenio, local 112, Milenio III.',phone:'442 283 4928',eta:'35–50 min'}
]
