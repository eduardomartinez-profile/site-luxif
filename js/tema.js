(function () {
	const raiz = document.documentElement;
	const ESCURO_ABAIXO_DE = 50;
	const CLARO_ACIMA_DE = 100;
	const sistemaEscuro = window.matchMedia("(prefers-color-scheme: dark)");

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

	let escolha = ler(localStorage, "luxif-tema") || "auto";
	let temaPelaLuz = ler(sessionStorage, "luxif-tema-luz");

	function aplicar() {
		let tema = escolha;

		if (tema === "auto") {
			tema = temaPelaLuz || (sistemaEscuro.matches ? "escuro" : "claro");
		}

		raiz.dataset.tema = tema;

		document.querySelectorAll(".seletor-tema button").forEach(function (botao) {
			botao.setAttribute("aria-pressed", botao.dataset.escolha === escolha ? "true" : "false");
		});
	}

	window.temaLuxif = {
		escolher: function (novaEscolha) {
			escolha = novaEscolha;
			gravar(localStorage, "luxif-tema", escolha);
			aplicar();
		},

		informarLux: function (lux) {
			let novo = temaPelaLuz || raiz.dataset.tema;

			if (lux < ESCURO_ABAIXO_DE) {
				novo = "escuro";
			} else if (lux > CLARO_ACIMA_DE) {
				novo = "claro";
			}

			if (novo !== temaPelaLuz) {
				temaPelaLuz = novo;
				gravar(sessionStorage, "luxif-tema-luz", novo);
				aplicar();
			}
		},

		esquecerLux: function () {
			temaPelaLuz = null;
			gravar(sessionStorage, "luxif-tema-luz", null);
			aplicar();
		}
	};

	aplicar();
	sistemaEscuro.addEventListener("change", aplicar);

	document.addEventListener("DOMContentLoaded", function () {
		document.querySelectorAll(".seletor-tema button").forEach(function (botao) {
			botao.addEventListener("click", function () {
				temaLuxif.escolher(botao.dataset.escolha);
			});
		});
		aplicar();
	});
})();
