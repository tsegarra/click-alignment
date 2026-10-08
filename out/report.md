# Whisper → MFA vs. manual click alignments

Manual data: `user-data/alignments-2026-10-07.json`. Error = MFA time − click time (positive = MFA later).

## Coverage

- Manual clicks: 108
- Pairing: the nth click is compared with MFA's nth syllable in the line; word boundaries are ignored.
- Scored (MFA has a syllable at that position): 107 (99%)
  - paired syllable is the same syllable of the same word: 87
  - paired syllable belongs to a different word: 20
- Not scored, MFA ran out of syllables: 1
- **2pac-hell-is: 4 lyric syllables vs 5 MFA syllables**, so positional pairing drifts after the first difference
- **2pac-holla: 5 lyric syllables vs 8 MFA syllables**, so positional pairing drifts after the first difference
- **2pac-caravan: 5 lyric syllables vs 6 MFA syllables**, so positional pairing drifts after the first difference
- **2pac-later: 4 lyric syllables vs 3 MFA syllables**, so positional pairing drifts after the first difference

## Timing error: all scored syllables

**MFA syllable onset vs click**

| n | bias (ms) | median \|err\| | mean \|err\| | mean \|err\| after removing bias | ≤25 ms | ≤50 ms | ≤100 ms |
|---|---|---|---|---|---|---|---|
| 107 | -49 | 42 | 57 | 45 | 30% | 55% | 88% |

**MFA vowel onset vs click**

| n | bias (ms) | median \|err\| | mean \|err\| | mean \|err\| after removing bias | ≤25 ms | ≤50 ms | ≤100 ms |
|---|---|---|---|---|---|---|---|
| 107 | +14 | 23 | 35 | 29 | 51% | 82% | 93% |

**VPR vs click**

| n | bias (ms) | median \|err\| | mean \|err\| | mean \|err\| after removing bias | ≤25 ms | ≤50 ms | ≤100 ms |
|---|---|---|---|---|---|---|---|
| 107 | -8 | 17 | 29 | 30 | 69% | 87% | 93% |


## Timing error: same word on both sides

**MFA syllable onset vs click**

| n | bias (ms) | median \|err\| | mean \|err\| | mean \|err\| after removing bias | ≤25 ms | ≤50 ms | ≤100 ms |
|---|---|---|---|---|---|---|---|
| 87 | -42 | 39 | 50 | 40 | 33% | 57% | 92% |

**MFA vowel onset vs click**

| n | bias (ms) | median \|err\| | mean \|err\| | mean \|err\| after removing bias | ≤25 ms | ≤50 ms | ≤100 ms |
|---|---|---|---|---|---|---|---|
| 87 | +24 | 22 | 28 | 21 | 54% | 87% | 98% |

**VPR vs click**

| n | bias (ms) | median \|err\| | mean \|err\| | mean \|err\| after removing bias | ≤25 ms | ≤50 ms | ≤100 ms |
|---|---|---|---|---|---|---|---|
| 87 | +3 | 12 | 20 | 20 | 77% | 92% | 98% |

## Per clip (all scored syllables, vowel-onset anchor, then syllable-onset anchor)

| clip | WER | syllables (lyrics/MFA) | scored | bias vowel | median \|err\| vowel | bias onset | median \|err\| onset |
|---|---|---|---|---|---|---|---|
| 2pac-all-eyez-on-me | 0% | 12/12 | 12/12 | +24 | 22 | -33 | 39 |
| bdk-set-it-off | 0% | 15/15 | 15/15 | +20 | 22 | -38 | 27 |
| eminem-my-name-is | 0% | 11/11 | 11/11 | +14 | 13 | -46 | 48 |
| method-man-plo-style | 0% | 11/11 | 11/11 | +13 | 25 | -56 | 62 |
| nas-it-aint-hard-to-tell | 0% | 13/13 | 13/13 | +25 | 22 | -67 | 50 |
| ice-spice-munch | 44% | 9/9 | 9/9 | +23 | 26 | -24 | 14 |
| migos-supastars | 9% | 11/11 | 11/11 | +30 | 23 | -27 | 24 |
| 2pac-hell-is | 75% | 4/5 | 4/4 | -6 | 14 | -63 | 54 |
| 2pac-holla | 167% | 5/8 | 5/5 | +76 | 52 | -6 | 43 |
| 2pac-caravan | 33% | 5/6 | 5/5 | -153 | 147 | -205 | 223 |
| 2pac-until | 0% | 5/5 | 5/5 | +21 | 20 | -41 | 72 |
| 2pac-later | 100% | 4/3 | 3/4 | +33 | 21 | -33 | 29 |
| 2pac-my-eyes | 100% | 3/3 | 3/3 | -15 | 49 | -65 | 41 |

## Transcripts and syllable pairing

### 2pac-all-eyez-on-me

- lyrics:  `was hyper as a kid cold as a teenager`
- whisper: `was hyper as a kid cold as a teenager`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | was (1/1) | was (1/1) | W AH0 Z | same_word | 42 | -42 | +8 |
| 1 | hyper (1/2) | hyper (1/2) | HH AY1 P ER0 | same_word | 166 | -36 | +4 |
| 2 | hyper (2/2) | hyper (2/2) | HH AY1 P ER0 | same_word | 359 | -79 | +21 |
| 3 | as (1/1) | as (1/1) | EH1 Z | same_word | 490 | +30 | +30 |
| 4 | a (1/1) | a (1/1) | AH0 | same_word | 628 | +22 | +22 |
| 5 | kid (1/1) | kid (1/1) | K IH1 D | same_word | 788 | -78 | +62 |
| 6 | cold (1/1) | cold (1/1) | K OW1 L D | same_word | 1128 | -28 | +32 |
| 7 | as (1/1) | as (1/1) | EH1 Z | same_word | 1438 | +22 | +22 |
| 8 | a (1/1) | a (1/1) | AH0 | same_word | 1597 | +33 | +33 |
| 9 | teenager (1/3) | teenager (1/3) | T IY1 N EY2 JH ER0 | same_word | 1768 | -88 | +42 |
| 10 | teenager (2/3) | teenager (2/3) | T IY1 N EY2 JH ER0 | same_word | 2089 | -69 | +1 |
| 11 | teenager (3/3) | teenager (3/3) | T IY1 N EY2 JH ER0 | same_word | 2249 | -79 | +11 |

### bdk-set-it-off

- lyrics:  `I get dramatic and rhymes start flowin' automatic'ly`
- whisper: `i get dramatic and rhymes start flowing automatically`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | I (1/1) | i (1/1) | AY1 | same_word | 19 | +21 | +21 |
| 1 | get (1/1) | get (1/1) | G IH1 T | same_word | 135 | -45 | +35 |
| 2 | dramatic (1/3) | dramatic (1/3) | D R AH0 M AE1 T IH0 K | same_word | 304 | -54 | +16 |
| 3 | dramatic (2/3) | dramatic (2/3) | D R AH0 M AE1 T IH0 K | same_word | 430 | -80 | +20 |
| 4 | dramatic (3/3) | dramatic (3/3) | D R AH0 M AE1 T IH0 K | same_word | 578 | -8 | +22 |
| 5 | and (1/1) | and (1/1) | AH0 N D | same_word | 837 | -27 | -27 |
| 6 | rhymes (1/1) | rhymes (1/1) | R AY1 M Z | same_word | 940 | +0 | +40 |
| 7 | start (1/1) | start (1/1) | S T AA1 R T | same_word | 1221 | -91 | -1 |
| 8 | flowin' (1/2) | flowing (1/2) | F L OW1 IH0 NG | same_word | 1424 | -24 | +66 |
| 9 | flowin' (2/2) | flowing (2/2) | F L OW1 IH0 NG | same_word | 1570 | +40 | +40 |
| 10 | automatic'ly (1/5) | automatically (1/5) | AO2 T AH0 M AE1 T IH0 K L IY0 | same_word | 1707 | -27 | -27 |
| 11 | automatic'ly (2/5) | automatically (2/5) | AO2 T AH0 M AE1 T IH0 K L IY0 | same_word | 1805 | -15 | +15 |
| 12 | automatic'ly (3/5) | automatically (3/5) | AO2 T AH0 M AE1 T IH0 K L IY0 | same_word | 1956 | -96 | +14 |
| 13 | automatic'ly (4/5) | automatically (4/5) | AO2 T AH0 M AE1 T IH0 K L IY0 | same_word | 2120 | -10 | +20 |
| 14 | automatic'ly (5/5) | automatically (5/5) | AO2 T AH0 M AE1 T IH0 K L IY0 | same_word | 2350 | -160 | +50 |

### eminem-my-name-is

- lyrics:  `I lay awake and strap myself in the bed`
- whisper: `i lay awake and strap myself in the bed`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | I (1/1) | i (1/1) | AY1 | same_word | 17 | +13 | +13 |
| 1 | lay (1/1) | lay (1/1) | L EY1 | same_word | 204 | -64 | +16 |
| 2 | awake (1/2) | awake (1/2) | AH0 W EY1 K | same_word | 336 | +4 | +4 |
| 3 | awake (2/2) | awake (2/2) | AH0 W EY1 K | same_word | 517 | -97 | +23 |
| 4 | and (1/1) | and (1/1) | AH0 N D | same_word | 768 | +22 | +22 |
| 5 | strap (1/1) | strap (1/1) | S T R AE1 P | same_word | 986 | -106 | +44 |
| 6 | myself (1/2) | myself (1/2) | M AY2 S EH1 L F | same_word | 1218 | -48 | +2 |
| 7 | myself (2/2) | myself (2/2) | M AY2 S EH1 L F | same_word | 1374 | -124 | +6 |
| 8 | in (1/1) | in (1/1) | IH0 N | same_word | 1596 | +14 | +14 |
| 9 | the (1/1) | the (1/1) | DH AH0 | same_word | 1720 | -40 | -0 |
| 10 | bed (1/1) | bed (1/1) | B EH1 D | same_word | 1827 | -77 | +13 |

### method-man-plo-style

- lyrics:  `anger comin' from the thirty sixth chamber`
- whisper: `anger coming from the thirty sixth chamber`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | anger (1/2) | anger (1/2) | AE1 NG G ER0 | same_word | 349 | -29 | -29 |
| 1 | anger (2/2) | anger (2/2) | AE1 NG G ER0 | same_word | 662 | -72 | -12 |
| 2 | comin' (1/2) | coming (1/2) | K AH1 M IH0 NG | same_word | 992 | -62 | -12 |
| 3 | comin' (2/2) | coming (2/2) | K AH1 M IH0 NG | same_word | 1121 | -71 | +9 |
| 4 | from (1/1) | from (1/1) | F ER0 M | same_word | 1259 | -69 | +11 |
| 5 | the (1/1) | the (1/1) | DH AH1 | same_word | 1434 | -14 | +26 |
| 6 | thirty (1/2) | thirty (1/2) | TH ER1 D IY0 | same_word | 1588 | -78 | +32 |
| 7 | thirty (2/2) | thirty (2/2) | TH ER1 D IY0 | same_word | 1775 | -35 | +25 |
| 8 | sixth (1/1) | sixth (1/1) | S IH1 K S TH | same_word | 1948 | -98 | +32 |
| 9 | chamber (1/2) | chamber (1/2) | CH EY1 M B ER0 | same_word | 2252 | -32 | +48 |
| 10 | chamber (2/2) | chamber (2/2) | CH EY1 M B ER0 | same_word | 2578 | -58 | +12 |

### nas-it-aint-hard-to-tell

- lyrics:  `speak with criminal slang begin like a violin`
- whisper: `speak with criminal slang begin like a violin`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | speak (1/1) | speak (1/1) | S P IY1 K | same_word | 193 | -193 | +17 |
| 1 | with (1/1) | with (1/1) | W IH0 TH | same_word | 458 | -38 | +22 |
| 2 | criminal (1/3) | criminal (1/3) | K R IH1 M AH0 N AH0 L | same_word | 571 | -11 | +139 |
| 3 | criminal (2/3) | criminal (2/3) | K R IH1 M AH0 N AH0 L | same_word | 762 | -12 | +48 |
| 4 | criminal (3/3) | criminal (3/3) | K R IH1 M AH0 N AH0 L | same_word | 897 | -27 | +13 |
| 5 | slang (1/1) | slang (1/1) | S L AE1 NG | same_word | 1169 | -169 | +51 |
| 6 | begin (1/2) | begin (1/2) | B IH0 G IH1 N | same_word | 1464 | -74 | +16 |
| 7 | begin (2/2) | begin (2/2) | B IH0 G IH1 N | same_word | 1611 | -71 | +29 |
| 8 | like (1/1) | like (1/1) | L AY1 K | same_word | 1960 | -50 | +10 |
| 9 | a (1/1) | a (1/1) | AH0 | same_word | 2135 | -15 | -15 |
| 10 | violin (1/3) | violin (1/3) | V AY0 AH0 L IH1 N | same_word | 2284 | -104 | -4 |
| 11 | violin (2/3) | violin (2/3) | V AY0 AH0 L IH1 N | same_word | 2430 | -30 | -30 |
| 12 | violin (3/3) | violin (3/3) | V AY0 AH0 L IH1 N | same_word | 2601 | -81 | +29 |

### ice-spice-munch

- lyrics:  `know they be mad I be on the scene`
- whisper: `not even mad i'd be on the scene`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | know (1/1) | not (1/1) | N AA1 T | different_word | 76 | -76 | +44 |
| 1 | they (1/1) | even (1/2) | IY1 V IH0 N | different_word | 202 | -2 | -2 |
| 2 | be (1/1) | even (2/2) | IY1 V IH0 N | different_word | 291 | -51 | -1 |
| 3 | mad (1/1) | mad (1/1) | M AE1 D | same_word | 435 | -5 | +35 |
| 4 | I (1/1) | i'd (1/1) | AY1 D | different_word | 619 | -9 | -9 |
| 5 | be (1/1) | be (1/1) | B IY0 | same_word | 786 | +4 | +34 |
| 6 | on (1/1) | on (1/1) | AA1 N | same_word | 878 | +22 | +22 |
| 7 | the (1/1) | the (1/1) | DH AH0 | same_word | 994 | -14 | +26 |
| 8 | scene (1/1) | scene (1/1) | S IY1 N | same_word | 1167 | -87 | +53 |

### migos-supastars

- lyrics:  `you got that swag you got that sauce then sell it`
- whisper: `you got that swag you got that swag then sell it`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | you (1/1) | you (1/1) | Y UW1 | same_word | 114 | -34 | +6 |
| 1 | got (1/1) | got (1/1) | G AA1 T | same_word | 189 | -39 | +31 |
| 2 | that (1/1) | that (1/1) | DH AE1 T | same_word | 376 | -16 | +14 |
| 3 | swag (1/1) | swag (1/1) | S W AE1 G | same_word | 565 | -55 | +75 |
| 4 | you (1/1) | you (1/1) | Y UW1 | same_word | 1246 | +24 | +74 |
| 5 | got (1/1) | got (1/1) | G AA1 T | same_word | 1354 | -4 | +46 |
| 6 | that (1/1) | that (1/1) | DH AE1 T | same_word | 1580 | -20 | +10 |
| 7 | sauce (1/1) | swag (1/1) | S W AE1 G | different_word | 1777 | -67 | +23 |
| 8 | then (1/1) | then (1/1) | DH EH1 N | same_word | 1950 | +0 | +30 |
| 9 | sell (1/1) | sell (1/1) | S EH1 L | same_word | 2162 | -82 | +18 |
| 10 | it (1/1) | it (1/1) | IH0 T | same_word | 2382 | -2 | -2 |

### 2pac-hell-is

- lyrics:  `of hell is where`
- whisper: `the hell is with a`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | of (1/1) | the (1/1) | DH AH0 | different_word | 43 | -43 | -13 |
| 1 | hell (1/1) | hell (1/1) | HH EH1 L | same_word | 238 | -148 | -28 |
| 2 | is (1/1) | is (1/1) | IH0 Z | same_word | 545 | +5 | +5 |
| 3 | where (1/1) | with (1/1) | W IH0 DH | different_word | 716 | -66 | +14 |

### 2pac-holla

- lyrics:  `nigga holla when`
- whisper: `nick i holla when you say it`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | nigga (1/2) | nick (1/1) | N IH1 K | different_word | 38 | -38 | +52 |
| 1 | nigga (2/2) | i (1/1) | AY1 | different_word | 256 | +44 | +44 |
| 2 | holla (1/2) | holla (1/2) | HH AA1 L AH0 | same_word | 325 | +5 | +165 |
| 3 | holla (2/2) | holla (2/2) | HH AA1 L AH0 | same_word | 477 | +43 | +73 |
| 4 | when (1/1) | when (1/1) | HH W IH1 N | same_word | 695 | -85 | +45 |

### 2pac-caravan

- lyrics:  `got a caravan`
- whisper: `i got a caravan`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | got (1/1) | i (1/1) | AY1 | different_word | 146 | -116 | -116 |
| 1 | a (1/1) | got (1/1) | G AA1 T | different_word | 294 | -224 | -104 |
| 2 | caravan (1/3) | a (1/1) | AH0 | different_word | 557 | -207 | -207 |
| 3 | caravan (2/3) | caravan (1/3) | K EH1 R AH0 V AE2 N | different_word | 647 | -257 | -147 |
| 4 | caravan (3/3) | caravan (2/3) | K EH1 R AH0 V AE2 N | different_word | 793 | -223 | -193 |

### 2pac-until

- lyrics:  `by until I die`
- whisper: `bye until i die`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | by (1/1) | bye (1/1) | B AY1 | same_word | 82 | -82 | -12 |
| 1 | until (1/2) | until (1/2) | AH0 N T IH1 L | same_word | 467 | +33 | +33 |
| 2 | until (2/2) | until (2/2) | AH0 N T IH1 L | same_word | 670 | -80 | +20 |
| 3 | I (1/1) | i (1/1) | AY1 | same_word | 834 | -4 | -4 |
| 4 | die (1/1) | die (1/1) | D AY1 | same_word | 952 | -72 | +68 |

### 2pac-later

- lyrics:  `crossed later the`
- whisper: `false lady`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | crossed (1/1) | false (1/1) | F AO1 L S | different_word | 69 | -69 | +11 |
| 1 | later (1/2) | lady (1/2) | L EY1 D IY0 | different_word | 352 | -2 | +68 |
| 2 | later (2/2) | lady (2/2) | L EY1 D IY0 | different_word | 549 | -29 | +21 |
| 3 | the (1/1) |  |  | no_mfa_syllable | 723 |  |  |

### 2pac-my-eyes

- lyrics:  `in my eyes`
- whisper: `the ma'a`

| click | lyric syllable | MFA syllable | phones | status | click ms | onset err | vowel err |
|---|---|---|---|---|---|---|---|
| 0 | in (1/1) | the (1/1) | DH IY0 | different_word | 32 | -32 | +28 |
| 1 | my (1/1) | ma'a (1/2) | M AE1 AH0 | different_word | 161 | -41 | +49 |
| 2 | eyes (1/1) | ma'a (2/2) | M AE1 AH0 | different_word | 392 | -122 | -122 |
