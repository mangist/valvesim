*
* Panel ammeter: a 0V voltage source in series with the circuit — the
* standard SPICE current probe. Reads as the branch-current vector of
* the internal source (flattened name: v.x<refdes>.vam).
*
.SUBCKT AMMETER P N
VAM P N 0
.ENDS
