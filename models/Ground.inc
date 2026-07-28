* Ground Point: chassis/earth ground reference (0V).
* Single-port subckt bonding the pin to node 0 through a milliohm-scale
* resistor, matching the bonding style already used for the AC inlet's
* PE lead and the transformer shield (see 120VAC.inc / 372HX.inc) rather
* than shorting the pin directly onto node 0.
.SUBCKT GROUND GND
R1 GND 0 10m
.ENDS GROUND
