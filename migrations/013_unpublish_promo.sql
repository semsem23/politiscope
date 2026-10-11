-- Dépublie les citations d'autopromo déjà en ligne.

-- Contexte : avant politiscope/selection.py, un tweet comme « Retrouvez mon
-- passage sur LCI ce soir » pouvait être publié. Le filtre empêche désormais
-- les nouveaux cas ; cette migration retire ceux déjà publiés
-- (`python scripts/audit_promo.py` produit la même liste).
--
-- Rien n'est supprimé ni modifié dans le texte : `publie` passe à false, donc
-- la policy RLS de 002 les masque du site, et `publications` les empêche
-- d'être reproposées. Chaque ligne est ciblée par (id, citation_key) pour ne
-- jamais toucher une autre entrée si les id étaient un jour réattribués.
--
-- Pour republier l'une d'elles :
--   update entries set publie = true where id = <id>;

begin;

update entries e
   set publie = false,
       updated_at = now()
  from (values
  (41, 'cesoirdes21hretrouvezmoisurlcipourunesoireespecialebudgetetcarburant'),  -- Éric Coquerel : 📺 Ce soir dès 21h, retrouvez-moi sur LCI pour une soirée spéciale budg
  (64, 'prixdescarburantsmobilisationspopulairesbudgetmanuelbompardinvitedetf1retrouvezenintegralitemonpassagedansbonjourlamatinalesurtf1dumercredi16septembre2026'),  -- Manuel Bompard : 🔴 Prix des carburants, mobilisations populaires, budget : Manuel Bompa
  (73, 'faceauxetatsunisfacealachineleuropedoitassumersapuissanceetdefendresesinteretsrendezvousdemainapartirde16h30areimspourmondiscourssurlavenirdeleurope'),  -- Gabriel Attal : Face aux États-Unis, face à la Chine, l’Europe doit assumer sa puissan
  (104, 'anciensabstentionnisteselecteursrnlrudrnouvelleenergiecestunhonneurdetousvousrecevoirpourlesdedicacescesoirrendezvousamentondemainacannes'),  -- Sarah Knafo : Anciens abstentionnistes, électeurs RN, LR, UDR, Nouvelle Energie : c’
  (106, 'cequejaiditamacronsurleprixducarburant'),  -- Manuel Bompard : Ce que j’ai dit à Macron sur le prix du carburant👇
  (110, 'milliardaireslextremedroiteeneuropeetcampagnepresidentielleretrouvezmonentretienfaceasamzirah'),  -- Manon Aubry : Milliardaires, l’extrême droite en Europe et campagne présidentielle !
  (113, 'retrouvezmoncommuniquealasuitedelasaisinehautconseildesfinancespubliquessurleplf2027jedenonceunesituationeconomiquedegradeequirisquedesouffrirdunbudgetinjusteetauxeffetsrecessifsavecsondernierbudgetlegouvernementrepeteses'),  -- Éric Coquerel : 🔴 Retrouvez mon communiqué à la suite de la saisine Haut conseil des f
  (123, 'prixdescarburantshaussedusmicmobilisationssocialesmanuelbompardinvitedertlretrouvezenintegralitemonpassagesurrtldulundi21septembre2026'),  -- Manuel Bompard : 🔴 Prix des carburants, hausse du SMIC, mobilisations sociales : Manuel
  (125, 'retrouvezlintegralitedemonpassagedobjectif2027surlcietleparisien'),  -- Nicolas Dupont-Aignan : Retrouvez l’intégralité de mon passage « d’Objectif 2027 » sur LCI et 
  (126, 'jetaislinvitedugrandjuryrtlpublicsenatouestfrancem6cedimanche20septembrejetaisinterrogeparolivierbostrtlquentincalmetpublicsenatetstephanevernayouestfrance'),  -- Louis Aliot : J’étais l’invité du Grand Jury RTL - Public Sénat - Ouest France - M6 
  (142, 'lavenirtechnologiqueeuropeensejouemaintenantquelquesmotsdepuisbadenbadenoujemesuisrendualinvitationdemariodraghi'),  -- Bruno Le Maire : L’avenir technologique européen se joue maintenant. Quelques mots depu
  (152, 'prixdescarburantsguerreenukrainemareactionalallocutiondemmanuelmacronretrouvezenintegralitemonpassagesurlcidujeudi24septembre2026'),  -- Manuel Bompard : 💥 Prix des carburants, guerre en Ukraine : ma réaction à l’allocution 
  (201, 'blocageslyceensbudgetsituationinternationalemanuelbompardinvitedefranceinterretrouvezenintegralitemonpassagesurfranceinterdumardi29septembre2026'),  -- Manuel Bompard : 🔴 Blocages lycéens, budget, situation internationale : Manuel Bompard,
  (221, 'jeveuxaiderlesfrancaisadevenirproprietairesdeleurslogementsretrouvezmes30mesurespourrelancerlaconstructionbatimatilsontdesmilliardsnousavonsdesconvictionsfaitesundonadeboutlafrance'),  -- Nicolas Dupont-Aignan : 🔴Je veux aider les Français à devenir propriétaires de leurs logements
  (229, 'jetaislinvitedu8h30franceinfoecoutezlesrevendicationsdeslyceensle6octobresoutenonslesdanslaruebudget2027unzeropointemoninterviewestdisponiblesuryoutube'),  -- Éric Coquerel : 🔴 J’étais l’invité du 8h30 France info 👉Écoutez les revendications des
  (233, 'arriveafrancetvavecmonequiperendezvousa20h45surfrance2etfranceinterpourlegranddebatdelaprimairedelagauche'),  -- Olivier Faure : Arrivé à @FranceTV avec mon équipe, rendez vous à 20h45 sur France 2 e
  (241, 'retrouvezlequatriemeepisodedenotreemissionencampagneavisionnerici'),  -- Mathilde Panot : 🔴⚡️ Retrouvez le quatrième épisode de notre émission « En Campagne ! »
  (248, 'loiintegralelfietlembrasementdansleslyceesproposantisemitesattribuesajordanbardellanecessitedunecandidatureuniquedubloccentralretrouvezmonentretiendanslejdd'),  -- Aurore Bergé : 🗞 Loi intégrale, LFI et l’embrasement dans les lycées, propos antisémi
  (254, 'retrouvezenintegralitesurmonsiteinternetletextedemoninterventionalatribunedelassembleenationalealouverturedesdebatssurlapropositiondeloiditeintegralecontrelesviolencessexuellesetsexistesfaitesauxfemmesetauxenfants'),  -- Clémentine Autain : Retrouvez en intégralité sur mon site internet le texte de mon interve
  (260, 'soutienauxrevendicationsdeslyceensbudget2027jetaislinvitedepublicsenatvoirlintegralitedemoninterview'),  -- Éric Coquerel : 🔴📺 Soutien aux revendications des lycéens / budget 2027 : j’étais l’in
  (263, 'ledernierdebatdelaprimairedelagauchecestmaintenant'),  -- Olivier Faure : Le dernier débat de la primaire de la gauche, c’est maintenant ! 👉
  (282, 'acesoirsurlcijechangeraiaveclajeunessepouruneemissionspecialesurlemouvementlyceenlecoleetsonavenir'),  -- Gabriel Attal : À ce soir sur LCI. J’échangerai avec la jeunesse pour une émission spé
  (283, 'decouvrezmoncontrebudgetde140milliardsdeurosdeconomiesparan'),  -- Sarah Knafo : Découvrez mon contre-budget de 140 milliards d’euros d’économies par a
  (286, 'heureuxdavoirretrouvemonamijeanlassalleausommetelevageacournonnousavonstantafaireensemblepourdefendrelemonderuralabandonneretrouvezmonprojetpresidentiel2027'),  -- Nicolas Dupont-Aignan : Heureux d’avoir retrouvé mon ami @jeanlassalle au @SommetElevage à Cou
  (316, 'rendezvouscesoira17h45danslemissionlegrandenjeupresenteeparmyriamencaouapourrevenirsurlactualiteetlesresultatsdelaprimairechoisir2027acesoirsurfranceinfoetlereseauiciofficiel'),  -- Yannick Jadot : 🟡 Rendez-vous ce soir à 17h45 dans l’émission « Le Grand Enjeu », prés
  (319, 'lyceesdetteunioneuropeenneetcretrouvezmonentretienaumicrodetocsinmedia')  -- Nicolas Dupont-Aignan : 🔴Lycées, dette, Union européenne, etc. Retrouvez mon entretien au micr
  ) as t(id, citation_key)
 where e.id = t.id
   and e.citation_key = t.citation_key
   and e.publie;

commit;
