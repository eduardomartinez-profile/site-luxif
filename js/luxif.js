const luxif = {
	estado: "desconectado",
	mensagem: "Desconectado.",
	ultimaLeitura: null,

	// A página Ao vivo troca estas funções para mostrar os dados
	aoMudarEstado: function () {},
	aoReceberLeitura: function () {},
	aoReceberMensagem: function () {}
};

(function () {
	const SERVIDOR_MQTT = "wss://broker.hivemq.com:8884/mqtt";
	const BIBLIOTECA_MQTT = "https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js";
	const CANAL = "ifsp-luxif/";

	let clienteMqtt = null;
	let socket = null;
	let simulacao = null;
	let novaTentativa = null;
	let semLeituras = null;

	function ler(armazenamento, chave) {
		try {
			return armazenamento.getItem(chave);
		} catch (erro) {
			return null;
		}
	}

	function gravar(armazenamento, chave, valor) {
		try {
			if (valor === null) {
				armazenamento.removeItem(chave);
			} else {
				armazenamento.setItem(chave, valor);
			}
		} catch (erro) {}
	}

	luxif.formatarLux = function (lux) {
		return lux.toLocaleString("pt-BR", { maximumFractionDigits: lux < 10 ? 1 : 0 });
	};

	function atualizarIndicador() {
		const indicador = document.querySelector(".indicador-luxif");
		const ativo = luxif.estado === "conectado" || luxif.estado === "simulando";

		indicador.hidden = !(ativo && luxif.ultimaLeitura);
		if (luxif.ultimaLeitura) {
			indicador.querySelector("span").textContent = luxif.formatarLux(luxif.ultimaLeitura.lux) + " lx";
		}
	}

	function mudarEstado(estado, mensagem) {
		luxif.estado = estado;
		luxif.mensagem = mensagem;
		atualizarIndicador();
		luxif.aoMudarEstado();
	}

	function receber(leitura) {
		luxif.ultimaLeitura = leitura;
		temaLuxif.informarLux(leitura.lux);
		atualizarIndicador();
		luxif.aoReceberLeitura(leitura);
	}

	// O LUXIF manda {"lux":523.4,"percentage":100,"faixa":1}. O servidor do Vinícius
	// manda só lux e percentage (sem faixa), e um número sozinho também serve
	function lerMensagem(texto) {
		try {
			const dados = JSON.parse(texto);
			if (typeof dados === "number") return { lux: dados };
			if (typeof dados.lux === "number") return dados;
		} catch (erro) {}
		return null;
	}

	function parar() {
		clearTimeout(novaTentativa);
		clearTimeout(semLeituras);
		clearInterval(simulacao);

		if (clienteMqtt) {
			clienteMqtt.end(true);
			clienteMqtt = null;
		}

		if (socket) {
			socket.onclose = null;
			socket.close();
			socket = null;
		}
	}

	/* Pela internet: o ESP32 publica no servidor MQTT e o site assina o mesmo canal */

	function carregarBibliotecaMqtt(depois) {
		if (window.mqtt) {
			depois();
			return;
		}

		const script = document.createElement("script");
		script.src = BIBLIOTECA_MQTT;
		script.onload = depois;
		script.onerror = function () {
			mudarEstado("erro", "Não foi possível carregar a biblioteca MQTT. Verifique a conexão com a internet.");
		};
		document.head.appendChild(script);
	}

	function esperarLeituras() {
		clearTimeout(semLeituras);
		semLeituras = setTimeout(function () {
			mudarEstado("aguardando", "Conectado ao servidor, mas o LUXIF não envia leituras há 10 segundos. Ele está ligado e no Wi-Fi?");
		}, 10000);
	}

	function abrirInternet() {
		mudarEstado("conectando", "Conectando ao servidor MQTT…");

		carregarBibliotecaMqtt(function () {
			if (luxif.modo() !== "internet") return;
			clienteMqtt = mqtt.connect(SERVIDOR_MQTT);

			clienteMqtt.on("connect", function () {
				clienteMqtt.subscribe([CANAL + "leituras", CANAL + "respostas"]);
				mudarEstado("aguardando", "Conectado ao servidor. Esperando as leituras do LUXIF…");
				esperarLeituras();
			});

			clienteMqtt.on("message", function (canal, dados) {
				const texto = dados.toString();
				luxif.aoReceberMensagem(texto);
				if (canal !== CANAL + "leituras") return;

				const leitura = lerMensagem(texto);
				if (!leitura) return;

				if (luxif.estado !== "conectado") {
					mudarEstado("conectado", "Recebendo as leituras do LUXIF pela internet.");
				}
				esperarLeituras();
				receber(leitura);
			});

			clienteMqtt.on("offline", function () {
				clearTimeout(semLeituras);
				mudarEstado("erro", "Sem conexão com o servidor MQTT. Tentando de novo…");
			});
		});
	}

	/* Na mesma rede: o site conecta direto no ESP32 pelo endereço IP */

	function abrirLocal(endereco) {
		mudarEstado("conectando", "Conectando a " + endereco + "…");

		try {
			socket = new WebSocket(endereco);
		} catch (erro) {
			mudarEstado("erro", "O navegador bloqueou a conexão com " + endereco + ".");
			return;
		}

		socket.onopen = function () {
			// O servidor do Vinícius só registra o cliente depois da primeira mensagem
			socket.send("conectado");
			mudarEstado("conectado", "Conectado a " + endereco + ".");
		};

		socket.onmessage = function (evento) {
			luxif.aoReceberMensagem(evento.data);
			const leitura = lerMensagem(evento.data);
			if (leitura) receber(leitura);
		};

		socket.onclose = function () {
			socket = null;
			mudarEstado("erro", "Sem resposta do LUXIF em " + endereco + ". Tentando de novo em 5 segundos…");
			novaTentativa = setTimeout(function () {
				abrirLocal(endereco);
			}, 5000);
		};
	}

	/* Simulação: leituras inventadas, para testar sem o aparelho */

	function simular() {
		mudarEstado("simulando", "Simulação: leituras geradas pelo site, sem o aparelho.");
		let segundos = 0;

		simulacao = setInterval(function () {
			segundos += 0.5;
			const lux = 300 + 290 * Math.sin(segundos / 6) + Math.random() * 10;
			const faixa = lux > 400 ? 0 : 1;
			receber({ lux: lux, faixa: faixa });
		}, 500);
	}

	luxif.conectarInternet = function () {
		parar();
		gravar(sessionStorage, "luxif-modo", "internet");
		abrirInternet();
	};

	luxif.conectarLocal = function (endereco) {
		endereco = endereco.trim();
		if (!endereco.startsWith("ws")) endereco = "ws://" + endereco;
		// Sem caminho no endereço, usa /ws (porta 80, a padrão): ws://192.168.0.10/ws
		if (endereco.replace("://", "").indexOf("/") === -1) endereco = endereco + "/ws";

		parar();
		gravar(localStorage, "luxif-endereco", endereco);
		gravar(sessionStorage, "luxif-modo", "local");
		abrirLocal(endereco);
		return endereco;
	};

	luxif.simular = function () {
		parar();
		gravar(sessionStorage, "luxif-modo", "simulacao");
		simular();
	};

	luxif.desconectar = function () {
		parar();
		gravar(sessionStorage, "luxif-modo", null);
		luxif.ultimaLeitura = null;
		temaLuxif.esquecerLux();
		mudarEstado("desconectado", "Desconectado.");
	};

	luxif.enviar = function (texto) {
		if (clienteMqtt && clienteMqtt.connected) {
			clienteMqtt.publish(CANAL + "mensagens", texto);
			return true;
		}
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(texto);
			return true;
		}
		return false;
	};

	luxif.enderecoSalvo = function () {
		return ler(localStorage, "luxif-endereco");
	};

	luxif.modo = function () {
		return ler(sessionStorage, "luxif-modo");
	};

	// Continua conectado (ou simulando) ao trocar de página
	const modo = luxif.modo();
	if (modo === "internet") {
		abrirInternet();
	} else if (modo === "local" && luxif.enderecoSalvo()) {
		abrirLocal(luxif.enderecoSalvo());
	} else if (modo === "simulacao") {
		simular();
	}
})();
