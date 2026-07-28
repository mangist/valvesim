*
* Panel voltmeter: a very high input impedance across the measured
* nodes (10Meg, like a real DMM) so it barely loads the circuit.
* The reading is simply v(P) - v(N) from the solved node voltages.
*
.SUBCKT VOLTMETER P N
RVM P N 10Meg
.ENDS
