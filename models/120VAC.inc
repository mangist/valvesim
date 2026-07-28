*
* 120V AC Input: IEC-320 C14 mains inlet with integrated rocker switch.
* Models the wall-mains source seen at the inlet: 120VRMS/60Hz sine
* between L and N. PE (protective earth) is bonded to simulation
* ground (node 0) through a small resistance, standard practice for
* schematic-level tube-amp simulation (chassis/star ground reference).
* A large resistor from N to 0 avoids a floating-node solver error
* when nothing downstream references ground yet.
*
.SUBCKT 120VAC L N PE
VAC L N SIN(0 169.7 60)
RPE PE 0 10m
RNGND N 0 10Meg
.ENDS
